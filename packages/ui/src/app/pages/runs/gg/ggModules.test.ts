// A gg run folded by module instance rather than by agent instance.
//
// The one thing worth pinning above all others is the distinction the whole feature exists
// for: **two agents sharing one store** against **two agents holding distinct stores whose
// contents happen to agree**. Those two runs are indistinguishable in every other view, and
// telling them apart is the difference between "the shared-memory ablation is working" and
// "the shared-memory ablation silently fell back to private notebooks".
//
// The rest pin the derivations that make the three module surfaces trustworthy: the scope is
// read off the observed holders and never off the declared configuration (the configuration
// is the thing being audited), the lifetime is assembled from the transitions in order, and
// the cost is attributed per band.

import { describe, expect, it } from "vitest";
import type {
  GgAgentModule,
  GgCapabilitySet,
  GgModuleKind,
  GgTelemetryEvent,
  GgTelemetryKind,
  GgTransitionModule,
} from "@test-cabinet/run-record/gg";
import type { HarnessEvent } from "../../../../client/types";
import {
  coHolders,
  concurrentHolders,
  declaredModuleConfig,
  deriveGgModules,
  isCarried,
  isShared,
  moduleOriginLabel,
  moduleScopeLabel,
} from "./ggModules";
import { reduceGgEvents, reduceGgEventsPerAgent } from "./useGgRunState";

const TS = "2026-07-29T00:00:00Z";
// A later stamp, so a lifetime has an order to be asserted in.
const TS2 = "2026-07-29T00:01:00Z";

function gg(
  agentId: string,
  kind: GgTelemetryKind,
  parentAgentId?: string,
  timestamp = TS,
): HarnessEvent {
  return {
    type: "gg",
    timestamp,
    event: {
      timestamp,
      sessionId: "s1",
      agentId,
      parentAgentId,
      ...kind,
    } as GgTelemetryEvent,
  };
}

function spawn(
  agentId: string,
  slot: string,
  parentAgentId?: string,
): HarnessEvent {
  return gg(
    agentId,
    {
      type: "agent_spawned",
      slot,
      modelId: "acme/one",
      depth: parentAgentId == null ? 0 : 1,
    } as GgTelemetryKind,
    parentAgentId,
  );
}

/** One roster row. Everything not named takes the value an ordinary private module has. */
function held(
  kind: GgModuleKind,
  moduleId: string,
  overrides: Partial<GgAgentModule> = {},
): GgAgentModule {
  return {
    kind,
    moduleId,
    enabled: true,
    ownership: "owned",
    origin: "created",
    writable: true,
    ...overrides,
  };
}

/** The roster event one instance emits as it opens. */
function roster(
  agentId: string,
  modules: GgAgentModule[],
  parentAgentId?: string,
): HarnessEvent {
  return gg(
    agentId,
    { type: "agent_modules", modules } as GgTelemetryKind,
    parentAgentId,
  );
}

/** A memory snapshot, so a module instance has contents to report. */
function memoryState(
  agentId: string,
  moduleId: string,
  names: string[],
): HarnessEvent {
  return gg(agentId, {
    type: "memory_state",
    moduleId,
    strategy: "",
    memories: names.map((name) => ({
      name,
      description: "",
      len: 10,
      lines: 1,
    })),
    count: names.length,
    totalLen: 10 * names.length,
    totalLines: names.length,
    peak: { count: names.length, totalLen: 10 * names.length, totalLines: 1 },
    caps: {
      maxCount: null,
      maxLenPerMemory: null,
      maxTotalLen: null,
      maxLenIndex: null,
      maxLenDescription: null,
      maxResults: null,
    },
    scope: "",
    writable: true,
  } as GgTelemetryKind);
}

/** A window breakdown, so a holder's module band has a cost. */
function breakdown(
  agentId: string,
  bands: Partial<Record<string, number>>,
  totalTokens: number,
): HarnessEvent {
  return gg(agentId, {
    type: "context_breakdown",
    bySource: Object.entries(bands).map(([source, tokens]) => ({
      source,
      tokens: tokens ?? 0,
    })),
    totalTokens,
  } as unknown as GgTelemetryKind);
}

function transition(
  fromAgentId: string,
  toAgentId: string,
  kind: "exec" | "fork" | "fsm",
  modules: GgTransitionModule[],
  timestamp = TS2,
): HarnessEvent {
  return gg(
    fromAgentId,
    {
      type: "agent_transition",
      kind,
      toAgentId,
      agent: "Root",
      modules,
    } as GgTelemetryKind,
    undefined,
    timestamp,
  );
}

/** A capability set declaring `agents`, each with the given capability ids enabled. */
function set(agents: Array<[string, string[]]>): GgCapabilitySet {
  return {
    agents: agents.map(([name, capabilities]) => ({
      name,
      modelId: "acme/one",
      capabilities: capabilities.map((id) => ({
        id,
        enabled: true,
        params: {},
      })),
      disabledTools: [],
      subagents: [],
      promptCacheTtl: "default",
    })),
    slots: [],
  } as unknown as GgCapabilitySet;
}

/** Fold a stream the way the console does, then index its modules. */
function index(events: HarnessEvent[], capabilitySet: GgCapabilitySet | null) {
  const derived = reduceGgEvents(events);
  return deriveGgModules(
    capabilitySet,
    derived.agentForest,
    reduceGgEventsPerAgent(events),
    derived.transitions,
    derived.moduleSnapshots,
  );
}

describe("deriveGgModules", () => {
  it("reads two agents sharing one store as two holders of it", () => {
    // Both instances of the Reviewer profile report the SAME memory instance — a `shared`
    // scope, resolved. This is the case the whole feature exists to make visible.
    const events = [
      spawn("root", "Root"),
      roster("root", [held("history", "history-0")]),
      spawn("agent-0", "Reviewer", "root"),
      roster(
        "agent-0",
        [
          held("history", "history-1"),
          held("memories", "memories-0", {
            origin: "profile",
            scope: "shared",
          }),
        ],
        "root",
      ),
      spawn("agent-1", "Reviewer", "root"),
      roster(
        "agent-1",
        [
          held("history", "history-2"),
          held("memories", "memories-0", {
            origin: "profile",
            scope: "shared",
          }),
        ],
        "root",
      ),
      memoryState("agent-0", "memories-0", ["the-plan"]),
    ];

    const modules = index(
      events,
      set([
        ["Root", []],
        ["Reviewer", ["memories"]],
      ]),
    );

    const store = modules.byId.get("memories-0")!;
    expect(store.holders.map((h) => h.agentId)).toEqual(["agent-0", "agent-1"]);
    expect(isShared(store)).toBe(true);
    expect(store.scopeKind).toBe("agent");
    expect(store.profile).toBe("Reviewer");
    expect(moduleScopeLabel(store)).toBe("shared by 2 holders of Reviewer");
    expect(coHolders(store, "agent-0").map((h) => h.agentId)).toEqual([
      "agent-1",
    ]);
    // Its contents are the store's, held once — not once per holder.
    expect(store.content?.kind).toBe("memories");
    expect(
      modules.byKind.find((g) => g.kind === "memories")!.instances,
    ).toHaveLength(1);
  });

  it("reads two agents holding identical contents as two stores", () => {
    // The control for the case above: byte-identical memory snapshots, two ids. Before
    // module identity these two runs were indistinguishable in the record.
    const events = [
      spawn("root", "Root"),
      roster("root", [held("history", "history-0")]),
      spawn("agent-0", "Reviewer", "root"),
      roster(
        "agent-0",
        [held("history", "history-1"), held("memories", "memories-0")],
        "root",
      ),
      spawn("agent-1", "Reviewer", "root"),
      roster(
        "agent-1",
        [held("history", "history-2"), held("memories", "memories-1")],
        "root",
      ),
      memoryState("agent-0", "memories-0", ["the-plan"]),
      memoryState("agent-1", "memories-1", ["the-plan"]),
    ];

    const modules = index(
      events,
      set([
        ["Root", []],
        ["Reviewer", ["memories"]],
      ]),
    );

    expect(modules.byId.get("memories-0")!.holders).toHaveLength(1);
    expect(modules.byId.get("memories-1")!.holders).toHaveLength(1);
    expect(modules.byId.get("memories-0")!.scopeKind).toBe("instance");
    expect(
      modules.byKind.find((g) => g.kind === "memories")!.instances,
    ).toHaveLength(2);
    // And the profile fold says so at the grain a configuration is tuned at.
    const reviewer = modules.byProfile.get("Reviewer")!;
    expect(reviewer.find((row) => row.kind === "memories")!.sharing).toBe(
      "instance",
    );
  });

  it("tells a store two instances share from one they held in turn", () => {
    // Both are "2 holders" and only one of them is sharing. A successor that took its
    // predecessor's window replaced it rather than joining it, so nothing was ever held by
    // two instances at once — which is the difference between agent-scoped state and an
    // ordinary succession, and the one a holder count cannot make.
    const events = [
      spawn("root", "Root"),
      roster("root", [held("history", "history-0")]),
      spawn("agent-0", "Reviewer", "root"),
      roster(
        "agent-0",
        [
          held("history", "history-1"),
          held("memories", "memories-0", { origin: "profile" }),
        ],
        "root",
      ),
      spawn("agent-1", "Reviewer", "root"),
      roster(
        "agent-1",
        [
          held("history", "history-2"),
          held("memories", "memories-0", { origin: "profile" }),
        ],
        "root",
      ),
      spawn("agent-2", "Root"),
      roster("agent-2", [
        held("history", "history-0", { origin: "transferred" }),
      ]),
    ];

    const modules = index(
      events,
      set([
        ["Root", []],
        ["Reviewer", ["memories"]],
      ]),
    );

    const window = modules.byId.get("history-0")!;
    expect(window.holders).toHaveLength(2);
    expect(concurrentHolders(window).map((h) => h.agentId)).toEqual(["root"]);
    const notebook = modules.byId.get("memories-0")!;
    expect(concurrentHolders(notebook).map((h) => h.agentId)).toEqual([
      "agent-0",
      "agent-1",
    ]);
  });

  it("calls a store held across profiles run-scoped", () => {
    // The board is the case: every agent in a run holds the one board, whatever profile it
    // runs. Nothing special-cases it — it lands here because its holders span profiles.
    const events = [
      spawn("root", "Root"),
      roster("root", [
        held("history", "history-0"),
        held("board", "board-0", { origin: "run" }),
      ]),
      spawn("agent-0", "Implementer", "root"),
      roster(
        "agent-0",
        [
          held("history", "history-1"),
          held("board", "board-0", { origin: "run" }),
        ],
        "root",
      ),
    ];

    const modules = index(
      events,
      set([
        ["Root", ["project-management"]],
        ["Implementer", ["project-management"]],
      ]),
    );

    const board = modules.byId.get("board-0")!;
    expect(board.scopeKind).toBe("run");
    expect(board.profile).toBeNull();
    expect(moduleScopeLabel(board)).toBe("shared by 2 holders across the run");
    expect(moduleOriginLabel(board, board.holders[1]!)).toBe(
      "bound the run's one instance",
    );
    // At the profile grain that reads as "shared beyond this agent".
    expect(
      modules.byProfile.get("Root")!.find((row) => row.kind === "board")!
        .sharing,
    ).toBe("run");
  });

  it("assembles a lifetime from the transitions, oldest first", () => {
    // One exec that carries the window, one fork that copies the task list and links the
    // board. Four instances between them, each with its own story.
    const events = [
      spawn("root", "Root"),
      roster("root", [
        held("history", "history-0"),
        held("tasks", "tasks-0"),
        held("board", "board-0", { origin: "run" }),
      ]),
      transition("root", "agent-0", "exec", [
        {
          kind: "history",
          disposition: "carried",
          fromModuleId: "history-0",
          toModuleId: "history-0",
        },
        {
          kind: "tasks",
          disposition: "dropped",
          fromModuleId: "tasks-0",
        },
        {
          kind: "board",
          disposition: "carried",
          fromModuleId: "board-0",
          toModuleId: "board-0",
        },
      ]),
      gg(
        "agent-0",
        {
          type: "agent_modules",
          modules: [
            held("history", "history-0", { origin: "transferred" }),
            held("board", "board-0", { origin: "run" }),
          ],
        } as GgTelemetryKind,
        "root",
        TS2,
      ),
      gg(
        "agent-0",
        {
          type: "agent_spawned",
          slot: "Verifier",
          modelId: "acme/one",
          depth: 0,
        } as GgTelemetryKind,
        "root",
        TS2,
      ),
    ];

    const modules = index(
      events,
      set([["Root", ["tasks", "project-management"]]]),
    );

    const history = modules.byId.get("history-0")!;
    expect(history.lifetime.map((event) => event.kind)).toEqual([
      "created",
      "carried",
    ]);
    expect(history.lifetime[1]).toMatchObject({
      fromAgentId: "root",
      toAgentId: "agent-0",
      via: "exec",
    });
    expect(history.holders.map((h) => h.agentId)).toEqual(["root", "agent-0"]);
    expect(moduleOriginLabel(history, history.holders[1]!)).toBe(
      "carried from root",
    );

    // The task list did not travel, and its last event says so.
    const tasks = modules.byId.get("tasks-0")!;
    expect(tasks.lifetime.map((event) => event.kind)).toEqual([
      "created",
      "dropped",
    ]);
    expect(tasks.dropped).toBe(true);
    expect(history.dropped).toBe(false);
  });

  it("distinguishes a fork's copied store from its linked one", () => {
    const events = [
      spawn("root", "Root"),
      roster("root", [
        held("history", "history-0"),
        held("tasks", "tasks-0"),
        held("board", "board-0", { origin: "run" }),
      ]),
      transition("root", "agent-0", "fork", [
        {
          kind: "history",
          disposition: "copied",
          fromModuleId: "history-0",
          toModuleId: "history-1",
        },
        {
          kind: "tasks",
          disposition: "copied",
          fromModuleId: "tasks-0",
          toModuleId: "tasks-1",
        },
        {
          kind: "board",
          disposition: "linked",
          fromModuleId: "board-0",
          toModuleId: "board-0",
        },
      ]),
      gg(
        "agent-0",
        {
          type: "agent_spawned",
          slot: "Root",
          modelId: "acme/one",
          depth: 1,
        } as GgTelemetryKind,
        "root",
        TS2,
      ),
      gg(
        "agent-0",
        {
          type: "agent_modules",
          modules: [
            held("history", "history-1", { origin: "forked" }),
            held("tasks", "tasks-1", { origin: "forked" }),
            held("board", "board-0", { origin: "run" }),
          ],
        } as GgTelemetryKind,
        "root",
        TS2,
      ),
    ];

    const modules = index(
      events,
      set([["Root", ["tasks", "project-management"]]]),
    );

    // The copy's own list: a second store, with a copied-from pointer back to its origin.
    // ONE row, not two: the fork's child is the store's first holder, so a synthesized
    // `created` would describe the same instant as the `copied` — and, since the transition
    // is emitted on the spawner's stream before the child's `agent_spawned`, would sort
    // *after* it and read as a store copied before it existed.
    const copiedTasks = modules.byId.get("tasks-1")!;
    expect(copiedTasks.holders.map((h) => h.agentId)).toEqual(["agent-0"]);
    expect(copiedTasks.lifetime.map((e) => e.kind)).toEqual(["copied"]);
    expect(copiedTasks.lifetime[0]!.copiedFromModuleId).toBe("tasks-0");
    expect(modules.byId.get("tasks-0")!.holders).toHaveLength(1);

    // The board: one store, two holders, and a `linked` row rather than a `copied` one.
    const board = modules.byId.get("board-0")!;
    expect(board.holders).toHaveLength(2);
    expect(board.lifetime.map((e) => e.kind)).toEqual(["created", "linked"]);
  });

  it("reports a store swap as the predecessor letting go of its own", () => {
    // A `shared`-scoped successor re-binds to its own profile's registry entry, so a module
    // the transition calls "carried" arrives under a DIFFERENT id. That is legal, and it is
    // exactly what two ids on one row are for.
    const events = [
      spawn("root", "Root"),
      roster("root", [
        held("history", "history-0"),
        held("memories", "memories-0"),
      ]),
      transition("root", "agent-0", "exec", [
        {
          kind: "memories",
          disposition: "carried",
          fromModuleId: "memories-0",
          toModuleId: "memories-1",
        },
      ]),
      gg(
        "agent-0",
        {
          type: "agent_spawned",
          slot: "Reviewer",
          modelId: "acme/one",
          depth: 0,
        } as GgTelemetryKind,
        "root",
        TS2,
      ),
      gg(
        "agent-0",
        {
          type: "agent_modules",
          modules: [
            held("memories", "memories-1", {
              origin: "profile",
              scope: "shared",
            }),
          ],
        } as GgTelemetryKind,
        "root",
        TS2,
      ),
    ];

    const modules = index(
      events,
      set([
        ["Root", ["memories"]],
        ["Reviewer", ["memories"]],
      ]),
    );

    expect(modules.byId.get("memories-1")!.lifetime.map((e) => e.kind)).toEqual(
      ["created", "carried"],
    );
    // The predecessor's store went nowhere: nobody is holding it any more.
    const old = modules.byId.get("memories-0")!;
    expect(old.lifetime.map((e) => e.kind)).toEqual(["created", "dropped"]);
    expect(old.dropped).toBe(true);
  });

  it("attributes a module's cost to the band it occupies, per holder", () => {
    const events = [
      spawn("root", "Root"),
      roster("root", [
        held("history", "history-0"),
        held("memories", "memories-0", { origin: "profile", scope: "shared" }),
        held("archive", "archive-0"),
      ]),
      breakdown("root", { memory: 400, history: 1000 }, 2000),
      breakdown("root", { memory: 900, history: 1200 }, 3000),
      spawn("agent-0", "Root", "root"),
      roster(
        "agent-0",
        [
          held("history", "history-1"),
          held("memories", "memories-0", {
            origin: "profile",
            scope: "shared",
          }),
        ],
        "root",
      ),
      breakdown("agent-0", { memory: 900, history: 100 }, 2000),
    ];

    const modules = index(
      events,
      set([["Root", ["memories", "agent-managed-context"]]]),
    );

    const store = modules.byId.get("memories-0")!;
    expect(store.holders[0]!.cost).toEqual({
      latestTokens: 900,
      peakTokens: 900,
      share: 900 / 3000,
    });
    // What it costs the run, per turn, across its live holders — the "is this earning its
    // keep" figure, and the one no per-agent view can state.
    expect(store.totalCost?.latestTokens).toBe(1800);

    // The window is the whole window rather than a band of it.
    expect(modules.byId.get("history-0")!.holders[0]!.cost).toEqual({
      latestTokens: 3000,
      peakTokens: 3000,
      share: null,
    });
    // The archive is out of the window by definition, so it has no band and no rent.
    expect(modules.byId.get("archive-0")!.holders[0]!.cost).toBeNull();
    expect(modules.byId.get("archive-0")!.totalCost).toBeNull();
  });

  it("folds a profile's instances over the stores they hold", () => {
    const events = [
      spawn("root", "Root"),
      roster("root", [held("history", "history-0")]),
      spawn("agent-0", "Reviewer", "root"),
      roster(
        "agent-0",
        [
          held("history", "history-1"),
          held("memories", "memories-0", { origin: "profile" }),
        ],
        "root",
      ),
      spawn("agent-1", "Reviewer", "root"),
      roster(
        "agent-1",
        [
          held("history", "history-2"),
          held("memories", "memories-0", { origin: "profile" }),
        ],
        "root",
      ),
      spawn("agent-2", "Reviewer", "root"),
      // The interesting failure: one instance of the profile did NOT bind the shared store.
      roster(
        "agent-2",
        [held("history", "history-3"), held("memories", "memories-1")],
        "root",
      ),
    ];

    const modules = index(
      events,
      set([
        ["Root", []],
        ["Reviewer", ["memories"]],
      ]),
    );

    const reviewer = modules.byProfile.get("Reviewer")!;
    const memories = reviewer.find((row) => row.kind === "memories")!;
    expect(memories.sharing).toBe("mixed");
    // The hold carries the store itself, so a surface reading a profile's row can show its
    // holders, its lifetime and its contents without a second lookup.
    expect(
      memories.instances.map((hold) => [
        hold.module.id,
        hold.holdersInProfile,
        hold.module.holders.length,
      ]),
    ).toEqual([
      ["memories-0", 2, 2],
      ["memories-1", 1, 1],
    ]);
    expect(memories.holdingInstances).toBe(3);
    // Nothing is the agent's: two of its three instances share a store and the third does
    // not, so there is no one store whose contents are the profile's.
    expect(memories.agentScoped).toBeNull();
    // Three instances, three windows — each its own, which is what a window always is.
    expect(reviewer.find((row) => row.kind === "history")!.sharing).toBe(
      "instance",
    );
    // A declared profile the run never instantiated still gets a row rather than a hole.
    expect(modules.byProfile.get("Root")).toBeDefined();
  });

  it("carries the declared configuration beside the observed one", () => {
    const declared = {
      agents: [
        {
          name: "Reviewer",
          modelId: "acme/one",
          capabilities: [
            {
              id: "memories",
              enabled: true,
              params: { scope: "inherited" },
            },
            {
              id: "agent-managed-context",
              enabled: true,
              params: { ownership: "unowned" },
            },
          ],
          disabledTools: [],
          subagents: [],
          promptCacheTtl: "default",
        },
      ],
      slots: [],
    } as unknown as GgCapabilitySet;

    expect(declaredModuleConfig(declared, "Reviewer", "archive")).toEqual({
      ownership: "unowned",
      scope: null,
    });
    // Absent params read as their defaults, which is what every configuration written
    // before they existed has.
    expect(declaredModuleConfig(declared, "Reviewer", "board")).toEqual({
      ownership: "owned",
      scope: null,
    });
    // Memories keeps its scope and has no ownership to declare at all.
    expect(declaredModuleConfig(declared, "Reviewer", "memories")).toEqual({
      ownership: null,
      scope: "inherited",
    });
  });

  // Skills, memories and the task list have no `ownership` param behind them any more (or,
  // for tasks, ever), so there is nothing for a configuration to have asked. Reading the
  // old default back would be worse than saying nothing: `moduleDivergences` compares the
  // declared value against what the holders report, and a manufactured `owned` would put a
  // finding on the Agents tab about a declaration nobody wrote.
  it("invents no ownership for a kind whose capability has no such param", () => {
    const declared = {
      agents: [
        {
          name: "Root",
          modelId: "acme/one",
          capabilities: [
            // Even where a stale configuration still carries the key — gg ignores it, and
            // so must the surface that reports what was asked for.
            {
              id: "memories",
              enabled: true,
              params: { ownership: "unowned" },
            },
            { id: "skills", enabled: true, params: {} },
            { id: "tasks", enabled: true, params: {} },
          ],
          disabledTools: [],
          subagents: [],
          promptCacheTtl: "default",
        },
      ],
      slots: [],
    } as unknown as GgCapabilitySet;

    for (const kind of ["memories", "skills", "tasks"] as const) {
      expect(declaredModuleConfig(declared, "Root", kind).ownership).toBeNull();
    }
  });

  it("reports no ownership divergence for a kind that cannot declare one", () => {
    // The phantom this gates: every holder reports an ownership, and comparing it against
    // an invented `owned` produced a divergence on a row whose capability offers no such
    // control. An unowned-looking store carried in from elsewhere is still a fact about
    // the module — it is just not a departure from anything this profile asked for.
    const modules = index(
      [
        spawn("root", "Root"),
        roster("root", [
          held("history", "history-0"),
          held("memories", "memories-0", { ownership: "unowned" }),
        ]),
      ],
      set([["Root", ["memories"]]]),
    );

    const memories = modules.byProfile
      .get("Root")!
      .find((row) => row.kind === "memories")!;
    expect(memories.declared).toEqual({ ownership: null, scope: "isolated" });
    expect(memories.divergences).toEqual([]);
  });

  it("reads a store handed to a successor as carried, never as shared", () => {
    // Two holders, and only one of them ever had it. Every module surface reads `isShared`
    // and `scopeKind`, so deriving either from the raw holder count made an `exec` — and
    // every state of an FSM run, which is a succession per state — indistinguishable from
    // the agent-scoped sharing the whole feature exists to find.
    const events = [
      spawn("root", "Root"),
      roster("root", [held("history", "history-0"), held("tasks", "tasks-0")]),
      transition("root", "agent-0", "exec", [
        {
          kind: "history",
          disposition: "carried",
          fromModuleId: "history-0",
          toModuleId: "history-0",
        },
        {
          kind: "tasks",
          disposition: "carried",
          fromModuleId: "tasks-0",
          toModuleId: "tasks-0",
        },
      ]),
      gg(
        "agent-0",
        {
          type: "agent_spawned",
          slot: "Root",
          modelId: "acme/one",
          depth: 0,
        } as GgTelemetryKind,
        undefined,
        TS2,
      ),
      gg(
        "agent-0",
        {
          type: "agent_modules",
          modules: [
            held("history", "history-0", { origin: "transferred" }),
            held("tasks", "tasks-0", { origin: "transferred" }),
          ],
        } as GgTelemetryKind,
        undefined,
        TS2,
      ),
    ];

    const modules = index(events, set([["Root", ["tasks"]]]));

    for (const id of ["history-0", "tasks-0"]) {
      const store = modules.byId.get(id)!;
      expect(store.holders).toHaveLength(2);
      expect(isShared(store)).toBe(false);
      expect(isCarried(store)).toBe(true);
      expect(store.scopeKind).toBe("carried");
      expect(store.profile).toBeNull();
      expect(moduleScopeLabel(store)).toBe(
        "held one instance at a time, through 2 holders",
      );
    }
    // And nobody is calling it dropped: the successor is holding it right now.
    expect(modules.byId.get("tasks-0")!.dropped).toBe(false);
  });

  it("keeps a store alive while any holder still has it", () => {
    // A `dropped` disposition is one OUTGOING instance's release, not the store's end. gg
    // reports it whenever a successor's profile does not enable the capability — which says
    // nothing about the run-global board every other instance is still writing.
    const events = [
      spawn("root", "Root"),
      roster("root", [
        held("history", "history-0"),
        held("board", "board-0", { origin: "run" }),
        held("memories", "memories-0"),
      ]),
      spawn("agent-0", "Implementer", "root"),
      roster(
        "agent-0",
        [
          held("history", "history-1"),
          held("board", "board-0", { origin: "run" }),
        ],
        "root",
      ),
      // The root execs into a profile that has neither the board nor memories.
      transition("root", "agent-1", "exec", [
        {
          kind: "history",
          disposition: "carried",
          fromModuleId: "history-0",
          toModuleId: "history-0",
        },
        { kind: "board", disposition: "dropped", fromModuleId: "board-0" },
        {
          kind: "memories",
          disposition: "dropped",
          fromModuleId: "memories-0",
        },
      ]),
      gg(
        "agent-1",
        {
          type: "agent_spawned",
          slot: "Plain",
          modelId: "acme/one",
          depth: 0,
        } as GgTelemetryKind,
        undefined,
        TS2,
      ),
      gg(
        "agent-1",
        {
          type: "agent_modules",
          modules: [held("history", "history-0", { origin: "transferred" })],
        } as GgTelemetryKind,
        undefined,
        TS2,
      ),
    ];

    const modules = index(
      events,
      set([
        ["Root", ["project-management", "memories"]],
        ["Implementer", ["project-management"]],
        ["Plain", []],
      ]),
    );

    // The board: the root let go, the Implementer did not, so the store is still there.
    const board = modules.byId.get("board-0")!;
    expect(board.holders.map((h) => h.agentId)).toEqual(["root", "agent-0"]);
    expect(board.dropped).toBe(false);
    // The root's private notebook: its only holder let go, so it really is gone.
    expect(modules.byId.get("memories-0")!.dropped).toBe(true);
    // And the carried window is not dropped by the hand-off that moved it.
    expect(modules.byId.get("history-0")!.dropped).toBe(false);
  });

  it("orders a forked store's life from the copy that made it", () => {
    // The fork's `agent_transition` is emitted on the SPAWNER's stream as soon as the child
    // is dispatched, and the child's `agent_spawned` — the source of a synthesized creation
    // stamp — lands after it. A `created` row would therefore sort behind the `copied` one
    // and the store would read as having been copied before it existed.
    const events = [
      spawn("root", "Root"),
      roster("root", [held("tasks", "tasks-0")]),
      transition(
        "root",
        "agent-0",
        "fork",
        [
          {
            kind: "tasks",
            disposition: "copied",
            fromModuleId: "tasks-0",
            toModuleId: "tasks-1",
          },
        ],
        TS,
      ),
      gg(
        "agent-0",
        {
          type: "agent_spawned",
          slot: "Root",
          modelId: "acme/one",
          depth: 1,
        } as GgTelemetryKind,
        "root",
        TS2,
      ),
      gg(
        "agent-0",
        {
          type: "agent_modules",
          modules: [held("tasks", "tasks-1", { origin: "forked" })],
        } as GgTelemetryKind,
        "root",
        TS2,
      ),
    ];

    const modules = index(events, set([["Root", ["tasks"]]]));

    expect(modules.byId.get("tasks-1")!.lifetime).toEqual([
      expect.objectContaining({
        kind: "copied",
        toAgentId: "agent-0",
        copiedFromModuleId: "tasks-0",
      }),
    ]);
  });

  it("does not invent stores for an instance whose roster is still in flight", () => {
    // A live stream always has a window between an instance's `agent_spawned` and its
    // `agent_modules`. An instance in it holds nothing — inferring what its capabilities
    // say it must have held would flicker phantom stores into every count and out again,
    // and would briefly report a profile as having two stores where its configuration
    // asked for one.
    const events = [
      spawn("root", "Root"),
      roster("root", [
        held("history", "history-0"),
        held("memories", "memories-0", { origin: "profile" }),
      ]),
      // Spawned, roster not yet arrived.
      spawn("agent-0", "Reviewer", "root"),
    ];

    const modules = index(
      events,
      set([
        ["Root", ["memories"]],
        ["Reviewer", ["memories"]],
      ]),
    );

    expect(modules.byAgent.get("agent-0")).toEqual([]);
    expect([...modules.byId.keys()]).toEqual(["history-0", "memories-0"]);
    // And the profile that has not reported yet holds nothing rather than a phantom store.
    expect(modules.byProfile.get("Reviewer")).toEqual([]);
  });
});
