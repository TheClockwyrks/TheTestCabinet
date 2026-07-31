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
// is the thing being audited), the lifetime is assembled from the transitions in order, the
// cost is attributed per band, and a record written before module identity existed still
// produces exactly today's per-agent shape rather than an empty screen.

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
  declaredModuleConfig,
  deriveGgModules,
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
    const copiedTasks = modules.byId.get("tasks-1")!;
    expect(copiedTasks.holders.map((h) => h.agentId)).toEqual(["agent-0"]);
    expect(copiedTasks.lifetime.map((e) => e.kind)).toEqual([
      "created",
      "copied",
    ]);
    expect(copiedTasks.lifetime[1]!.copiedFromModuleId).toBe("tasks-0");
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
    expect(memories.instances).toEqual([
      { id: "memories-0", holdersInProfile: 2, totalHolders: 2 },
      { id: "memories-1", holdersInProfile: 1, totalHolders: 1 },
    ]);
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
              params: { scope: "inherited", ownership: "unowned" },
            },
          ],
          disabledTools: [],
          subagents: [],
          promptCacheTtl: "default",
        },
      ],
      slots: [],
    } as unknown as GgCapabilitySet;

    expect(declaredModuleConfig(declared, "Reviewer", "memories")).toEqual({
      ownership: "unowned",
      scope: "inherited",
    });
    // Absent params read as their defaults, which is what every configuration written
    // before they existed has.
    expect(declaredModuleConfig(declared, "Reviewer", "tasks")).toEqual({
      ownership: "owned",
      scope: null,
    });
  });

  it("synthesizes private instances for a record written before module identity", () => {
    // No rosters at all — an old run. Every surface must degrade to exactly today's
    // per-agent behaviour rather than going blank.
    const events = [
      spawn("root", "Root"),
      gg("root", {
        type: "memory_state",
        strategy: "",
        memories: [],
        count: 0,
        totalLen: 0,
        totalLines: 0,
        peak: { count: 0, totalLen: 0, totalLines: 0 },
        caps: {
          maxCount: null,
          maxLenPerMemory: null,
          maxTotalLen: null,
          maxLenIndex: null,
          maxLenDescription: null,
          maxResults: null,
        },
        scope: "shared",
        writable: true,
        // No `moduleId`, which is the whole point of this fixture: it is what a record
        // written before module identity existed looks like, and the cast is what lets the
        // test build one the current contract would not.
      } as unknown as GgTelemetryKind),
      spawn("agent-0", "Reviewer", "root"),
    ];

    const modules = index(
      events,
      set([
        ["Root", ["memories"]],
        ["Reviewer", ["tasks"]],
      ]),
    );

    expect(modules.identified).toBe(false);
    // One private instance per (agent, enabled capability), plus each agent's window.
    expect(modules.byAgent.get("root")!.map((m) => m.id)).toEqual([
      "legacy:root:history",
      "legacy:root:memories",
    ]);
    expect(modules.byAgent.get("agent-0")!.map((m) => m.id)).toEqual([
      "legacy:agent-0:history",
      "legacy:agent-0:tasks",
    ]);
    // Nothing is shared, because a record that could not say so must not be read as saying
    // it — even though this one's snapshot claims a `shared` scope.
    for (const module of modules.byId.values()) {
      expect(module.scopeKind).toBe("instance");
      expect(module.holders).toHaveLength(1);
    }
    expect(modules.byId.get("legacy:root:memories")!.holders[0]!.scope).toBe(
      "shared",
    );
    // And it still has CONTENTS to show. A pre-identity record's state events name no
    // module, so the per-module snapshots are keyed by ids these synthesized instances do
    // not have; falling back to the holder's own reduced slice is what keeps an old run's
    // module files readable instead of blank.
    expect(modules.byId.get("legacy:root:memories")!.content).toEqual({
      kind: "memories",
      memory: expect.objectContaining({ scope: "shared" }),
    });
  });

  it("marks a run that reported rosters as identified", () => {
    const modules = index(
      [spawn("root", "Root"), roster("root", [held("history", "history-0")])],
      set([["Root", []]]),
    );
    expect(modules.identified).toBe(true);
  });
});
