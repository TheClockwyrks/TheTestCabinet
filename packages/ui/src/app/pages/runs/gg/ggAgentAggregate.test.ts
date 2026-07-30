// A gg run folded per configured agent rather than per running instance.
//
// The thing worth pinning here is the grouping itself: a profile's figures must be the sum
// of its instances and nothing else. A run that spawns four reviewers and one implementer
// should say "reviewer × 4" with four reviewers' worth of tokens under it — not four rows,
// and not the implementer's spend leaking in. These also pin the cases that make the
// grouping non-obvious: the main agent (never spawned, so its profile comes from the
// configuration), a declared profile the run never used, and a profile the stream shows that
// the configuration does not carry.

import { describe, expect, it } from "vitest";
import type {
  GgAgentConfig,
  GgCapabilitySet,
  GgTelemetryEvent,
  GgTelemetryKind,
} from "@test-cabinet/run-record/gg";
import type { HarnessEvent } from "../../../../client/types";
import type { ModelPrices } from "../../../data/models";
import type { ModelNameLookup, ModelPriceLookup } from "./ggCost";
import { deriveGgAgentSummaries, UNNAMED_AGENT } from "./ggAgentAggregate";
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
  slot: string,
  modelId: string,
  parentAgentId?: string,
): HarnessEvent {
  return gg(
    agentId,
    {
      type: "agent_spawned",
      slot,
      modelId,
      depth: parentAgentId == null ? 0 : 1,
    } as GgTelemetryKind,
    parentAgentId,
  );
}

function usage(
  agentId: string,
  slot: string,
  modelId: string,
  tokens: { input?: number; output?: number },
): HarnessEvent {
  return gg(agentId, {
    type: "usage",
    slot,
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

function status(
  agentId: string,
  state: "running" | "blocked" | "done" | "failed",
): HarnessEvent {
  return gg(agentId, {
    type: "agent_status",
    status: state,
  } as GgTelemetryKind);
}

function profile(name: string, modelId: string, caps: string[]): GgAgentConfig {
  return {
    name,
    modelId,
    capabilities: caps.map((id) => ({ id, enabled: true })),
  } as GgAgentConfig;
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
  return deriveGgAgentSummaries(
    capabilitySet,
    derived.agentForest,
    reduceGgEventsPerAgent(events),
    priceOf,
    nameOf,
  );
}

describe("deriveGgAgentSummaries", () => {
  it("sums every instance of a profile into one row", () => {
    // One Root and three reviewers. The reviewers' row must carry all three reviewers'
    // spend, and only theirs.
    const events = [
      spawn("root", "Root", "vendor/big"),
      turn("root"),
      usage("root", "Root", "vendor/big", { input: 1000, output: 100 }),
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
        profile("Root", "vendor/big", ["shell", "subagents"]),
        profile("reviewer", "vendor/small", ["shell"]),
      ),
    );
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

  it("keeps a declared profile the run never instantiated", () => {
    // The point of an ablation arm that never ran is that you can see it did not.
    const summaries = summarize(
      [spawn("root", "Root", "vendor/big"), turn("root")],
      set(
        profile("Root", "vendor/big", ["shell"]),
        profile("critic", "vendor/small", ["shell"]),
      ),
    );
    const critic = summaries.find((s) => s.name === "critic");
    expect(critic?.instances).toEqual([]);
    expect(critic?.declared).toBe(true);
    expect(critic?.turns).toBe(0);
    expect(critic?.usage.anyTokens).toBe(false);
    // No responses, so no rate — null rather than a NaN reaching the read-out.
    expect(critic?.toolCallsPerResponse).toBeNull();
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
        spawn("root", "Root", "vendor/big"),
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
        profile("Root", "vendor/big", ["subagents"]),
        profile("worker", "vendor/small", ["filesystem"]),
      ),
    );
    const worker = summaries.find((s) => s.name === "worker");
    expect(worker!.instances).toHaveLength(4);
    expect(worker!.turns).toBe(5);
    expect(worker!.tools.totalCalls).toBe(4);
    expect(worker!.toolCallsPerResponse).toBeCloseTo(0.8, 12);

    // The Root took no turn of its own and called nothing, so it has no rate at all.
    expect(summaries.find((s) => s.name === "Root")!.toolCallsPerResponse).toBe(
      null,
    );
  });

  it("lists a profile the stream shows but the configuration does not carry", () => {
    const summaries = summarize(
      [
        spawn("root", "Root", "vendor/big"),
        spawn("a1", "ghost", "vendor/small", "root"),
        turn("a1"),
      ],
      set(profile("Root", "vendor/big", ["subagents"])),
    );
    const ghost = summaries.find((s) => s.name === "ghost");
    expect(ghost?.declared).toBe(false);
    expect(ghost?.instances.map((i) => i.id)).toEqual(["a1"]);
    // Declared profiles lead; an observed one follows them.
    expect(summaries.map((s) => s.name)).toEqual(["Root", "ghost"]);
  });

  it("reads the main agent's profile off the configuration when its stream never named one", () => {
    // The root is never spawned on a pre-attribution stream, so its profile is the
    // configuration's first — which is the root by definition, whatever it is called.
    const summaries = summarize(
      [turn("root"), usage("root", "Main", "vendor/big", { input: 10 })],
      set(profile("Main", "vendor/big", ["shell"])),
    );
    expect(summaries).toHaveLength(1);
    expect(summaries[0]!.name).toBe("Main");
    expect(summaries[0]!.instances.map((i) => i.id)).toEqual(["root"]);
  });

  it("groups an instance the stream never named under a single unnamed row", () => {
    // A placeholder built from an out-of-order status event, before (or without) its spawn.
    const summaries = summarize(
      [spawn("root", "Root", "vendor/big"), status("a7", "running")],
      set(profile("Root", "vendor/big", ["subagents"])),
    );
    expect(summaries.map((s) => s.name)).toEqual(["Root", UNNAMED_AGENT]);
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
        spawn("root", "Root", "vendor/big"),
        spawn("a1", "worker", "vendor/small", "root"),
        spawn("a2", "worker", "vendor/small", "root"),
        breakdown("a1", 200, 1000),
        breakdown("a2", 900, 1000),
      ],
      set(
        profile("Root", "vendor/big", ["subagents"]),
        profile("worker", "vendor/small", ["shell"]),
      ),
    );
    const worker = summaries.find((s) => s.name === "worker")!;
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
        spawn("root", "Root", "vendor/big"),
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
        profile("Root", "vendor/big", ["subagents"]),
        profile("worker", "vendor/big", ["filesystem", "shell"]),
      ),
    );
    const worker = summaries.find((s) => s.name === "worker")!;
    expect(worker.tools.tools.map((t) => [t.name, t.calls])).toEqual([
      ["read_file", 2],
      ["shell", 1],
    ]);
    // The same spec, read by both instances, carried for three agent-turns between them.
    const spec = worker.context.byFile.find((f) => f.key === "specs/spec.md");
    expect(spec?.messages).toBe(2);
    expect(spec?.turns).toBe(3);
    expect(spec?.billedTokens).toBeCloseTo(1500, 6);
    expect(spec?.cost).toBeCloseTo(1500 * 1e-5, 10);
  });

  it("summarizes a run whose configuration was never captured", () => {
    // No capability set: every profile is an observation, and the main agent reads under the
    // name its own spawn gave it.
    const summaries = summarize(
      [spawn("root", "Root", "vendor/big"), turn("root")],
      null,
    );
    expect(summaries.map((s) => s.name)).toEqual(["Root"]);
    expect(summaries[0]!.declared).toBe(false);
    expect(summaries[0]!.root).toBe(false);
    expect(summaries[0]!.capabilities).toEqual([]);
  });
});
