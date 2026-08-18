// A gg run folded per configured agent rather than per running instance.
//
// The thing worth pinning here is the grouping itself: a profile's figures must be the sum
// of its instances and nothing else. A run that spawns four reviewers and one implementer
// should say "reviewer × 4" with four reviewers' worth of tokens under it — not four rows,
// and not the implementer's spend leaking in. These also pin the cases that make the
// grouping non-obvious: the main agent (never spawned, so its profile comes from the
// configuration), a declared profile the run never used, a profile the stream shows that the
// configuration does not carry, and two profiles an operator gave the same name.

import { describe, expect, it } from "vitest";
import type {
  GgAgentApi,
  GgAgentConfig,
  GgAgentModule,
  GgCapabilitySet,
  GgModuleKind,
  GgTelemetryEvent,
  GgTelemetryKind,
  GgTransitionModule,
} from "@test-cabinet/run-record/gg";
import type { HarnessEvent } from "../../../../client/types";
import type { ModelPrices } from "../../../data/models";
import type { ModelNameLookup, ModelPriceLookup } from "./ggCost";
import { deriveGgAgentSummaries, UNKNOWN_PROFILE_ID } from "./ggAgentAggregate";
import { deriveGgModules } from "./ggModules";
import { reduceGgEvents, reduceGgEventsPerAgent } from "./useGgRunState";

const TS = "2026-07-29T00:00:00Z";

function gg(
  agentId: string,
  kind: GgTelemetryKind,
  parentAgentId?: string,
): HarnessEvent {
  return {
    type: "gg",
    timestamp: TS,
    event: {
      timestamp: TS,
      sessionId: "s1",
      agentId,
      parentAgentId,
      ...kind,
    } as GgTelemetryEvent,
  };
}

function spawn(
  agentId: string,
  profileId: string,
  modelId: string,
  parentAgentId?: string,
): HarnessEvent {
  return gg(
    agentId,
    {
      type: "agent_spawned",
      profileId,
      modelId,
      depth: parentAgentId == null ? 0 : 1,
    } as GgTelemetryKind,
    parentAgentId,
  );
}

function usage(
  agentId: string,
  profileId: string,
  modelId: string,
  tokens: { input?: number; output?: number },
): HarnessEvent {
  return gg(agentId, {
    type: "usage",
    profileId,
    modelId,
    tokens: {
      uncachedInput: tokens.input ?? null,
      cachedInput: null,
      output: tokens.output ?? null,
      reasoning: null,
    },
  } as GgTelemetryKind);
}

function turn(agentId: string): HarnessEvent {
  return gg(agentId, { type: "turn_started" } as GgTelemetryKind);
}

// One model-facing call, as a responses-as-code program's turn streams it. The opening half
// is what a count reads: it is emitted before the call runs, so a program stopped mid-call
// still shows the call it was making.
function apiCall(agentId: string, operation: string): HarnessEvent {
  // gg's own identity for what was called is the whole of what the wire carries — the key
  // the count is kept under, and the one string that would be the same had the program
  // been written in another language.
  return gg(agentId, { type: "api_call", operation } as GgTelemetryKind);
}

function status(
  agentId: string,
  state: "running" | "blocked" | "done" | "failed",
): HarnessEvent {
  return gg(agentId, {
    type: "agent_status",
    status: state,
  } as GgTelemetryKind);
}

// A capability is named either bare (taking its defaults) or as `[id, params]` — the params
// are what the configuration ASKED for about a module (`{ scope: "shared" }`), which the
// module fold reads as the declared half of what its instances then got.
type CapabilitySpec = string | [string, Record<string, unknown>];

// A declared profile: its id, and the display name it reads as — which defaults to the id,
// because nothing resolves a profile by reading its name.
function profile(
  id: string,
  modelId: string,
  caps: CapabilitySpec[],
  name = id,
): GgAgentConfig {
  return {
    id,
    name,
    modelId,
    capabilities: caps.map((cap) => {
      const [id, params] = Array.isArray(cap) ? cap : [cap, {}];
      return { id, enabled: true, params };
    }),
  } as GgAgentConfig;
}

/** One row of an instance's module roster. Defaults to a private, owned, writable store. */
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

/** The roster one instance emits as it opens. Two instances, one id, one store. */
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

/** The surface one instance reports as it opens — what it was offered, not what it called. */
function offered(
  agentId: string,
  tools: string[],
  apis?: GgAgentApi[],
): HarnessEvent {
  return gg(agentId, {
    type: "agent_surface",
    executionMode: apis ? "responses_as_code" : "tool_calling",
    tools,
    ...(apis ? { apis } : {}),
  } as GgTelemetryKind);
}

function set(...agents: GgAgentConfig[]): GgCapabilitySet {
  return { agents } as GgCapabilitySet;
}

const PRICES: Record<string, ModelPrices> = {
  "vendor/big": { uncachedInput: 1e-5, cachedInput: null, output: 1e-4 },
  "vendor/small": { uncachedInput: 1e-7, cachedInput: null, output: 1e-6 },
} as Record<string, ModelPrices>;
const priceOf: ModelPriceLookup = (id) => PRICES[id] ?? null;
const nameOf: ModelNameLookup = (id) =>
  id === "vendor/big" ? "Big Model" : null;

function summarize(
  events: HarnessEvent[],
  capabilitySet: GgCapabilitySet | null,
) {
  const derived = reduceGgEvents(events);
  const perAgent = reduceGgEventsPerAgent(events, capabilitySet);
  return deriveGgAgentSummaries(
    capabilitySet,
    derived.agentForest,
    perAgent,
    priceOf,
    nameOf,
    // The module index the Agents panel folds beside this one: a profile's module row is a
    // regrouping of it, since a store's holders span profiles and cannot be found one
    // profile at a time.
    deriveGgModules(
      capabilitySet,
      derived.agentForest,
      perAgent,
      derived.transitions,
      derived.moduleSnapshots,
    ),
  );
}

/** The module row of one profile's summary, for the kind the test is about. */
function moduleRow(
  summaries: ReturnType<typeof summarize>,
  profileId: string,
  kind: GgModuleKind,
) {
  return summaries
    .find((summary) => summary.profileId === profileId)!
    .modules.find((row) => row.kind === kind)!;
}

describe("deriveGgAgentSummaries", () => {
  it("sums every instance of a profile into one row", () => {
    // One Root and three reviewers. The reviewers' row must carry all three reviewers'
    // spend, and only theirs.
    const events = [
      spawn("root", "root", "vendor/big"),
      turn("root"),
      usage("root", "root", "vendor/big", { input: 1000, output: 100 }),
      ...["r1", "r2", "r3"].flatMap((id) => [
        spawn(id, "reviewer", "vendor/small", "root"),
        turn(id),
        turn(id),
        usage(id, "reviewer", "vendor/small", { input: 200, output: 20 }),
        status(id, "done"),
      ]),
    ];

    const summaries = summarize(
      events,
      set(
        profile("root", "vendor/big", ["shell", "subagents"], "Root"),
        profile("reviewer", "vendor/small", ["shell"]),
      ),
    );
    expect(summaries.map((s) => s.profileId)).toEqual(["root", "reviewer"]);
    // The names are what the rows read as; the ids are what they are grouped by.
    expect(summaries.map((s) => s.name)).toEqual(["Root", "reviewer"]);

    const [root, reviewer] = summaries;
    expect(root!.instances).toHaveLength(1);
    expect(root!.root).toBe(true);
    expect(root!.turns).toBe(1);
    expect(root!.usage.totalTokens).toBe(1100);
    expect(root!.modelName).toBe("Big Model");

    expect(reviewer!.instances.map((i) => i.id)).toEqual(["r1", "r2", "r3"]);
    expect(reviewer!.root).toBe(false);
    expect(reviewer!.turns).toBe(6);
    expect(reviewer!.usage.totalTokens).toBe(3 * 220);
    expect(reviewer!.statusCounts.done).toBe(3);
    // Priced at its own model's rate, not the Root's — three reviewers of input and output.
    expect(reviewer!.cost?.input).toBeCloseTo(3 * 200 * 1e-7, 12);
    expect(reviewer!.cost?.output).toBeCloseTo(3 * 20 * 1e-6, 12);
    // The catalog does not know the small model, so its id stands in for a display name.
    expect(reviewer!.modelName).toBe("vendor/small");
  });

  it("keeps two profiles that share a display name apart", () => {
    // A name is prose, so an operator may call two arms the same thing — here a reviewer
    // on the big model and one on the small. Grouping on the name would fold them into a
    // single row whose spend, turns and model are two configurations averaged together,
    // which is precisely the comparison the Agents panel exists to make. The id keeps them
    // two rows that happen to read alike.
    const events = [
      spawn("root", "root", "vendor/big"),
      spawn("r1", "reviewer", "vendor/big", "root"),
      turn("r1"),
      usage("r1", "reviewer", "vendor/big", { input: 1000, output: 100 }),
      spawn("r2", "reviewer-2", "vendor/small", "root"),
      turn("r2"),
      turn("r2"),
      usage("r2", "reviewer-2", "vendor/small", { input: 200, output: 20 }),
    ];

    const summaries = summarize(
      events,
      set(
        profile("root", "vendor/big", ["subagents"], "Root"),
        profile("reviewer", "vendor/big", ["shell"], "Reviewer"),
        profile("reviewer-2", "vendor/small", ["shell"], "Reviewer"),
      ),
    );

    expect(summaries.map((s) => s.profileId)).toEqual([
      "root",
      "reviewer",
      "reviewer-2",
    ]);
    expect(summaries.map((s) => s.name)).toEqual([
      "Root",
      "Reviewer",
      "Reviewer",
    ]);

    const [, first, second] = summaries;
    expect(first!.instances.map((i) => i.id)).toEqual(["r1"]);
    expect(second!.instances.map((i) => i.id)).toEqual(["r2"]);
    expect(first!.turns).toBe(1);
    expect(second!.turns).toBe(2);
    expect(first!.usage.totalTokens).toBe(1100);
    expect(second!.usage.totalTokens).toBe(220);
    // And each is priced at the model its own profile bound, not at one shared rate.
    expect(first!.modelIds).toEqual(["vendor/big"]);
    expect(second!.modelIds).toEqual(["vendor/small"]);
  });

  it("keeps a declared profile the run never instantiated", () => {
    // The point of a declared profile that never ran is that you can see it did not.
    const summaries = summarize(
      [spawn("root", "root", "vendor/big"), turn("root")],
      set(
        profile("root", "vendor/big", ["shell"], "Root"),
        profile("critic", "vendor/small", ["shell"]),
      ),
    );
    const critic = summaries.find((s) => s.profileId === "critic");
    expect(critic?.instances).toEqual([]);
    expect(critic?.declared).toBe(true);
    expect(critic?.turns).toBe(0);
    expect(critic?.usage.anyTokens).toBe(false);
    // No responses, so no rate — null rather than a NaN reaching the read-out.
    expect(critic?.callsPerResponse).toBeNull();
  });

  it("rates a profile's tool calls against its responses, not against its instances", () => {
    // The weighting this pins. One instance does the work — four calls over two turns —
    // and three more take a turn apiece and call nothing. The profile's answer is its
    // calls over its responses, 4 / 5 = 0.8. Averaging the instances' own rates instead
    // would give (2.0 + 0 + 0 + 0) / 4 = 0.5, letting three barely-used instances outvote
    // the one that actually ran; the two numbers differ here precisely so a regression to
    // the mean-of-means cannot pass.
    const call = (agentId: string) =>
      gg(agentId, {
        type: "tool_call",
        name: "read_file",
        args: {},
      } as GgTelemetryKind);

    const summaries = summarize(
      [
        spawn("root", "root", "vendor/big"),
        spawn("a1", "worker", "vendor/small", "root"),
        turn("a1"),
        turn("a1"),
        call("a1"),
        call("a1"),
        call("a1"),
        call("a1"),
        ...["a2", "a3", "a4"].flatMap((id) => [
          spawn(id, "worker", "vendor/small", "root"),
          turn(id),
        ]),
      ],
      set(
        profile("root", "vendor/big", ["subagents"], "Root"),
        profile("worker", "vendor/small", ["filesystem"]),
      ),
    );
    const worker = summaries.find((s) => s.profileId === "worker");
    expect(worker!.instances).toHaveLength(4);
    expect(worker!.turns).toBe(5);
    expect(worker!.calls.totalCalls).toBe(4);
    expect(worker!.callsPerResponse).toBeCloseTo(0.8, 12);

    // The Root took no turn of its own and called nothing, so it has no rate at all.
    expect(
      summaries.find((s) => s.profileId === "root")!.callsPerResponse,
    ).toBe(null);
  });

  it("lists a profile the stream shows but the configuration does not carry", () => {
    const summaries = summarize(
      [
        spawn("root", "root", "vendor/big"),
        spawn("a1", "ghost", "vendor/small", "root"),
        turn("a1"),
      ],
      set(profile("root", "vendor/big", ["subagents"], "Root")),
    );
    const ghost = summaries.find((s) => s.profileId === "ghost");
    expect(ghost?.declared).toBe(false);
    expect(ghost?.instances.map((i) => i.id)).toEqual(["a1"]);
    // A profile the configuration does not declare reads as the id it was spawned under —
    // there is nothing else to call it.
    expect(ghost?.name).toBe("ghost");
    // Declared profiles lead; an observed one follows them.
    expect(summaries.map((s) => s.profileId)).toEqual(["root", "ghost"]);
  });

  it("reads the main agent's profile off the configuration when its stream never named one", () => {
    // The root is never spawned on a pre-attribution stream, so its profile is the
    // configuration's first — which is the root by definition, whatever it is called.
    const summaries = summarize(
      [turn("root"), usage("root", "main", "vendor/big", { input: 10 })],
      set(profile("main", "vendor/big", ["shell"], "Main")),
    );
    expect(summaries).toHaveLength(1);
    expect(summaries[0]!.profileId).toBe("main");
    expect(summaries[0]!.name).toBe("Main");
    expect(summaries[0]!.instances.map((i) => i.id)).toEqual(["root"]);
  });

  it("groups an instance the stream never identified under a single unknown row", () => {
    // A placeholder built from an out-of-order status event, before (or without) its spawn.
    const summaries = summarize(
      [spawn("root", "root", "vendor/big"), status("a7", "running")],
      set(profile("root", "vendor/big", ["subagents"], "Root")),
    );
    expect(summaries.map((s) => s.profileId)).toEqual([
      "root",
      UNKNOWN_PROFILE_ID,
    ]);
    expect(summaries[1]!.declared).toBe(false);
  });

  it("reports peak context as the worst instance and the mean as a typical one", () => {
    const breakdown = (agentId: string, tokens: number, limit: number) =>
      gg(agentId, {
        type: "context_breakdown",
        bySource: [{ source: "system", tokens }],
        totalTokens: tokens,
        windowLimit: limit,
        fullness: tokens / limit,
      } as GgTelemetryKind);

    const summaries = summarize(
      [
        spawn("root", "root", "vendor/big"),
        spawn("a1", "worker", "vendor/small", "root"),
        spawn("a2", "worker", "vendor/small", "root"),
        breakdown("a1", 200, 1000),
        breakdown("a2", 900, 1000),
      ],
      set(
        profile("root", "vendor/big", ["subagents"], "Root"),
        profile("worker", "vendor/small", ["shell"]),
      ),
    );
    const worker = summaries.find((s) => s.profileId === "worker")!;
    expect(worker.peakFullness).toBeCloseTo(0.9, 6);
    expect(worker.meanPeakFullness).toBeCloseTo(0.55, 6);
    expect(worker.peakTokens).toBe(900);
  });

  it("aggregates tool usage and the context accounting across instances", () => {
    const call = (agentId: string, name: string) =>
      gg(agentId, {
        type: "tool_call",
        name,
        args: {},
      } as GgTelemetryKind);
    const view = (agentId: string, id: string, tokens: number, path: string) =>
      gg(agentId, {
        type: "context_message",
        id,
        role: "tool",
        content: "…",
        toolCalls: [],
        images: [],
        tokens,
        label: path,
      } as GgTelemetryKind);
    const request = (agentId: string, id: string, input: number) =>
      gg(agentId, {
        type: "prompt",
        request: [{ id, source: "file_view" }],
        totalTokens: 0,
        finishReason: "stop",
        tokens: {
          uncachedInput: input,
          cachedInput: null,
          output: null,
          reasoning: null,
        },
      } as unknown as GgTelemetryKind);

    const summaries = summarize(
      [
        spawn("root", "root", "vendor/big"),
        spawn("a1", "worker", "vendor/big", "root"),
        spawn("a2", "worker", "vendor/big", "root"),
        call("a1", "read_file"),
        call("a1", "shell"),
        call("a2", "read_file"),
        view("a1", "m1", 500, "specs/spec.md"),
        request("a1", "m1", 500),
        view("a2", "m2", 500, "specs/spec.md"),
        request("a2", "m2", 500),
        request("a2", "m2", 500),
      ],
      set(
        profile("root", "vendor/big", ["subagents"], "Root"),
        profile("worker", "vendor/big", ["filesystem", "shell"]),
      ),
    );
    const worker = summaries.find((s) => s.profileId === "worker")!;
    expect(worker.calls.calls.map((t) => [t.name, t.calls])).toEqual([
      ["read_file", 2],
      ["shell", 1],
    ]);
    // The same spec, read by both instances, carried for three agent-turns between them.
    const spec = worker.context.byView.find(
      (v) => v.key === "file:specs/spec.md",
    );
    expect(spec?.messages).toBe(2);
    expect(spec?.turns).toBe(3);
    expect(spec?.billedTokens).toBeCloseTo(1500, 6);
    expect(spec?.cost).toBeCloseTo(1500 * 1e-5, 10);
  });

  // --- The modules a profile holds ---------------------------------------------
  //
  // The one thing on a profile's row that is not a sum, and the distinction the whole
  // module read-out exists for: twelve instances may be reading ONE store or twelve, and
  // which of those it is *is* the configuration under test. Every other figure here folds
  // instances into one number; this one must not, and must never call twelve stores one.

  it("folds a shared memory store into one agent-scoped row", () => {
    // Two Reviewer instances report the same store id, which is what a resolved `shared`
    // scope looks like on the wire. At the profile's grain that is one store, and its
    // contents are the *agent's* — the only shape whose contents can honestly be shown here.
    const summaries = summarize(
      [
        spawn("root", "root", "vendor/big"),
        roster("root", [held("history", "history-0")]),
        spawn("r1", "reviewer", "vendor/small", "root"),
        roster(
          "r1",
          [
            held("history", "history-1"),
            held("memories", "memories-0", {
              origin: "profile",
              scope: "shared",
            }),
          ],
          "root",
        ),
        spawn("r2", "reviewer", "vendor/small", "root"),
        roster(
          "r2",
          [
            held("history", "history-2"),
            held("memories", "memories-0", {
              origin: "profile",
              scope: "shared",
            }),
          ],
          "root",
        ),
      ],
      set(
        profile("root", "vendor/big", ["subagents"], "Root"),
        profile("reviewer", "vendor/small", [
          ["memories", { scope: "shared" }],
        ]),
      ),
    );

    const memories = moduleRow(summaries, "reviewer", "memories");
    expect(memories.sharing).toBe("agent");
    expect(memories.agentScoped?.id).toBe("memories-0");
    expect(memories.holdingInstances).toBe(2);
    expect(memories.instances).toHaveLength(1);
    // A scope and no ownership: memories has no such param for a profile to have set.
    expect(memories.declared).toEqual({ ownership: null, scope: "shared" });
    // The configuration asked for a shared store and got one, so there is nothing to say.
    expect(memories.divergences).toEqual([]);
    // A window is never shared, whatever the memories do — so the same profile's history
    // row is one store per instance, and nothing about it belongs to the agent.
    const history = moduleRow(summaries, "reviewer", "history");
    expect(history.sharing).toBe("instance");
    expect(history.agentScoped).toBeNull();
    expect(history.instances).toHaveLength(2);
  });

  it("folds an isolated profile's memories into one store per instance", () => {
    // The other configuration, and the control for the test above: byte-for-byte the same
    // run except that the two instances report two ids. Nothing here belongs to the agent,
    // so `agentScoped` must be null — a surface that rendered either store as "the
    // reviewer's memories" would be lying about the other instance.
    const summaries = summarize(
      [
        spawn("root", "root", "vendor/big"),
        roster("root", [held("history", "history-0")]),
        spawn("r1", "reviewer", "vendor/small", "root"),
        roster(
          "r1",
          [held("history", "history-1"), held("memories", "memories-0")],
          "root",
        ),
        spawn("r2", "reviewer", "vendor/small", "root"),
        roster(
          "r2",
          [held("history", "history-2"), held("memories", "memories-1")],
          "root",
        ),
      ],
      set(
        profile("root", "vendor/big", ["subagents"], "Root"),
        profile("reviewer", "vendor/small", ["memories"]),
      ),
    );

    const memories = moduleRow(summaries, "reviewer", "memories");
    expect(memories.sharing).toBe("instance");
    expect(memories.agentScoped).toBeNull();
    expect(memories.instances.map((hold) => hold.module.id)).toEqual([
      "memories-0",
      "memories-1",
    ]);
    expect(memories.holdingInstances).toBe(2);
    // An absent scope is the default, and the default is what it got.
    expect(memories.declared).toEqual({
      ownership: null,
      scope: "isolated",
    });
    expect(memories.divergences).toEqual([]);
  });

  it("says so when a declared scope did not resolve the way it was written", () => {
    // The `MemoriesRuntime::resolve` fallback, which is otherwise completely silent: an
    // `inherited` agent with no spawner to inherit from quietly gets its own store, and the
    // record still reports the scope it asked for. This note is the only place it shows.
    const summaries = summarize(
      [
        spawn("root", "root", "vendor/big"),
        roster("root", [held("history", "history-0")]),
        spawn("r1", "reviewer", "vendor/small", "root"),
        roster(
          "r1",
          [
            held("history", "history-1"),
            held("memories", "memories-0", { scope: "inherited" }),
          ],
          "root",
        ),
      ],
      set(
        profile("root", "vendor/big", ["subagents"], "Root"),
        profile("reviewer", "vendor/small", [
          ["memories", { scope: "inherited" }],
        ]),
      ),
    );

    const memories = moduleRow(summaries, "reviewer", "memories");
    expect(memories.sharing).toBe("instance");
    expect(memories.divergences).toEqual([
      {
        declared: "inherited",
        observed: "nothing inherited",
        note: expect.stringContaining("no spawner to inherit from"),
      },
    ]);
  });

  it("calls a store handed to a successor carried, not shared", () => {
    // Two holders, and no sharing: the successor took the task list and the predecessor let
    // it go, so only ever one instance had it. Counting holders alone reads this exactly
    // like a store two instances curate together, which is the one thing this row must
    // never say — it would invite a reader to treat one instance's tasks as the agent's.
    const summaries = summarize(
      [
        spawn("root", "root", "vendor/big"),
        roster("root", [
          held("history", "history-0"),
          held("tasks", "tasks-0"),
        ]),
        gg("root", {
          type: "agent_transition",
          kind: "exec",
          toAgentId: "next",
          profileId: "root",
          modules: [
            {
              kind: "tasks",
              disposition: "carried",
              fromModuleId: "tasks-0",
              toModuleId: "tasks-0",
            } satisfies GgTransitionModule,
          ],
        } as GgTelemetryKind),
        spawn("next", "root", "vendor/big"),
        roster("next", [
          held("history", "history-1"),
          held("tasks", "tasks-0", { origin: "transferred" }),
        ]),
      ],
      set(profile("root", "vendor/big", ["tasks"], "Root")),
    );

    const tasks = moduleRow(summaries, "root", "tasks");
    expect(tasks.sharing).toBe("carried");
    expect(tasks.agentScoped).toBeNull();
    expect(tasks.instances).toHaveLength(1);
    expect(tasks.instances[0]!.module.holders.map((h) => h.agentId)).toEqual([
      "root",
      "next",
    ]);
  });

  it("summarizes a run whose configuration was never captured", () => {
    // No capability set: every profile is an observation, and the main agent reads under the
    // name its own spawn gave it.
    const summaries = summarize(
      [spawn("root", "root", "vendor/big"), turn("root")],
      null,
    );
    expect(summaries.map((s) => s.profileId)).toEqual(["root"]);
    // Nothing declares the profile, so its row reads as the id its spawn carried.
    expect(summaries.map((s) => s.name)).toEqual(["root"]);
    expect(summaries[0]!.declared).toBe(false);
    expect(summaries[0]!.root).toBe(false);
    expect(summaries[0]!.capabilities).toEqual([]);
  });

  it("unions its instances' offered surfaces and counts who saw each entry", () => {
    // Two reviewers, and they were not offered the same things: the second sat in an FSM
    // state that withholds `exec`. Taking either one's set as the profile's would assert
    // something false about the other, so the union is the answer and each entry says how
    // much of the profile it covers.
    const toolCall = (agentId: string, name: string) =>
      gg(agentId, { type: "tool_call", name, args: {} } as GgTelemetryKind);

    const summaries = summarize(
      [
        spawn("root", "root", "vendor/big"),
        offered("root", ["spawn_agent", "finish"]),
        spawn("r1", "reviewer", "vendor/small", "root"),
        offered("r1", ["read_file", "exec", "approve"]),
        toolCall("r1", "read_file"),
        spawn("r2", "reviewer", "vendor/small", "root"),
        offered("r2", ["read_file", "approve"]),
      ],
      set(
        profile("root", "vendor/big", ["subagents"], "Root"),
        profile("reviewer", "vendor/small", []),
      ),
    );

    const reviewer = summaries.find((s) => s.profileId === "reviewer")!;
    const surface = reviewer.surface!;
    expect(surface.executionMode).toBe("tool_calling");
    expect(surface.reportingInstances).toBe(2);
    // Order is the order the model was shown them, with the entry only one instance saw
    // appended where it first appeared — never a frequency sort.
    expect(surface.tools).toEqual([
      { name: "read_file", key: "read_file", offeredBy: 2 },
      { name: "exec", key: "exec", offeredBy: 1 },
      { name: "approve", key: "approve", offeredBy: 2 },
    ]);
    expect(surface.apis).toEqual([]);

    // The whole point of carrying both: `approve` was offered to both reviewers and called
    // by neither, which the observed breakdown alone cannot say.
    expect(reviewer.calls.calls.map((t) => t.name)).toEqual(["read_file"]);

    // The root's own surface is its own — a profile's union never reaches across profiles.
    expect(
      summaries
        .find((s) => s.profileId === "root")!
        .surface!.tools.map((t) => t.name),
    ).toEqual(["spawn_agent", "finish"]);
  });

  it("unions a responses-as-code profile's modules, keeping each function's own operation", () => {
    // The operation is the join key: a program's `readFile` is recorded as `files.read_file`
    // and its `openFile` as `views.open_file`, whether or not a gg tool runs underneath.
    // Every bound function carries one, so every one of them has a figure of its own.
    const files: GgAgentApi = {
      module: "files",
      path: "gg.files",
      description: "Read and write the workspace.",
      functions: [
        { name: "readFile", operation: "files.read_file" },
        { name: "writeFile", operation: "files.write_file" },
      ],
    };
    const views: GgAgentApi = {
      module: "views",
      path: "gg.views",
      description: "Show the model something.",
      functions: [{ name: "openFile", operation: "views.open_file" }],
    };

    const summaries = summarize(
      [
        spawn("root", "root", "vendor/big"),
        spawn("w1", "worker", "vendor/small", "root"),
        offered("w1", ["read_file", "write_file"], [files, views]),
        spawn("w2", "worker", "vendor/small", "root"),
        // The second worker never bound the view module at all, so the module itself is
        // partial.
        offered(
          "w2",
          ["read_file"],
          [{ ...files, functions: [files.functions[0]!] }],
        ),
      ],
      set(
        profile("root", "vendor/big", ["subagents"], "Root"),
        profile("worker", "vendor/small", ["responses-as-code"]),
      ),
    );

    const surface = summaries.find((s) => s.profileId === "worker")!.surface!;
    expect(surface.executionMode).toBe("responses_as_code");
    expect(surface.apis).toEqual([
      {
        module: "files",
        path: "gg.files",
        description: "Read and write the workspace.",
        offeredBy: 2,
        functions: [
          { name: "readFile", key: "files.read_file", offeredBy: 2 },
          { name: "writeFile", key: "files.write_file", offeredBy: 1 },
        ],
      },
      {
        module: "views",
        path: "gg.views",
        description: "Show the model something.",
        offeredBy: 1,
        functions: [{ name: "openFile", key: "views.open_file", offeredBy: 1 }],
      },
    ]);
  });

  it("sums a profile's api calls across its instances, tool or no tool", () => {
    // The other half of the offered-versus-called contrast, and the half the old tool-keyed
    // join could not produce: `views.openFile` runs a `read_file` and `views.current` runs
    // nothing, and both are calls this profile's programs made.
    const summaries = summarize(
      [
        spawn("root", "root", "vendor/big"),
        spawn("w1", "worker", "vendor/small", "root"),
        apiCall("w1", "views.open_file"),
        apiCall("w1", "views.current"),
        spawn("w2", "worker", "vendor/small", "root"),
        apiCall("w2", "views.open_file"),
      ],
      set(
        profile("root", "vendor/big", ["subagents"], "Root"),
        profile("worker", "vendor/small", ["responses-as-code"]),
      ),
    );

    const worker = summaries.find((s) => s.profileId === "worker")!;
    expect(worker.apiCalls.get("views.open_file")).toBe(2);
    expect(worker.apiCalls.get("views.current")).toBe(1);
    expect(summaries.find((s) => s.profileId === "root")!.apiCalls.size).toBe(
      0,
    );
  });

  it("leaves a run that never reported a surface with none, and nothing else changed", () => {
    // A profile whose instances have not reported what they were offered. A null surface is
    // what tells the panels to show nothing at all — an empty one would read as "offered
    // nothing" — and the rest of the row must fold exactly the same.
    const summaries = summarize(
      [
        spawn("root", "root", "vendor/big"),
        turn("root"),
        usage("root", "root", "vendor/big", { input: 100, output: 20 }),
      ],
      set(
        profile("root", "vendor/big", ["subagents"], "Root"),
        profile("reviewer", "vendor/small", []),
      ),
    );

    expect(summaries.map((s) => s.surface)).toEqual([null, null]);
    expect(summaries[0]!.turns).toBe(1);
    expect(summaries[0]!.usage.totalTokens).toBe(120);
  });
});
