// A gg run's generation rate — its tokens per second, per model and over the run.
//
// The rate is a pairing of two separately-recorded facts: the tokens an agent generated
// (its `usage` deltas) and the time it spent inside its model calls (`turn_timing`'s
// `requestMs`). These pin that pairing — that it folds onto the models agents were bound
// to, and that the run's overall figure is its whole generation over its whole model time
// rather than the mean of the per-model rates.

import { describe, expect, it } from "vitest";
import type {
  GgTelemetryEvent,
  GgTelemetryKind,
} from "@clockwyrks/run-record/gg";
import type { HarnessEvent } from "../../../../client/types";
import type { ModelNameLookup } from "./ggCost";
import { deriveGgThroughput, formatThroughput } from "./ggThroughput";
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

// What one agent generated: the output (and any separately-reported reasoning) half of a
// usage delta, which is the rate's numerator. The input classes are irrelevant to a
// generation rate, so they are left unreported.
function generated(
  agentId: string,
  output: number,
  reasoning?: number,
): HarnessEvent {
  return gg(agentId, {
    type: "usage",
    tokens: {
      uncachedInput: null,
      cachedInput: null,
      output,
      reasoning: reasoning ?? null,
    },
  } as GgTelemetryKind);
}

// One turn's phase split, as gg emits it at the end of every turn whatever the run's
// capabilities. `requestMs` — the model call itself — is the rate's denominator.
function timing(agentId: string, requestMs: number): HarnessEvent {
  return gg(agentId, {
    type: "turn_timing",
    promptMs: 5,
    requestMs,
    responseMs: 5,
  } as GgTelemetryKind);
}

const NAMES: Record<string, string> = {
  "vendor/big": "Big 1",
  "vendor/small": "Small 1",
};
const nameOf: ModelNameLookup = (id) => NAMES[id] ?? null;

// Fold a stream the way the Dashboard does: the whole-run reduction for the agent forest,
// the per-agent one for each agent's own tokens and timings.
function throughputOf(events: HarnessEvent[]) {
  return deriveGgThroughput(
    reduceGgEvents(events).agentForest,
    reduceGgEventsPerAgent(events),
    nameOf,
  );
}

describe("a gg run's generation rate", () => {
  it("reads the run's whole generation over its whole model time, not the mean of its models' rates", () => {
    // A big model grinding (400 tokens over 4s = 100 tok/s) and a small one sprinting on a
    // single short call (100 tokens over 0.5s = 200 tok/s). The run generated 500 tokens in
    // 4.5s of model time, so it ran at ~111 tok/s — the mean of the two rates (150) would
    // credit the run with a pace the model doing nearly all of its work never hit.
    const throughput = throughputOf([
      spawn("root", "root", "vendor/big"),
      spawn("agent-0", "reviewer", "vendor/small", "root"),
      generated("root", 300, 100),
      timing("root", 4000),
      generated("agent-0", 100),
      timing("agent-0", 500),
    ]);

    expect(throughput.generatedTokens).toBe(500);
    expect(throughput.modelMs).toBe(4500);
    expect(throughput.overall).toBeCloseTo(500 / 4.5, 6);
    expect(formatThroughput(throughput.overall!)).toBe("111 tok/s");

    // Per model, fastest first, each named from the catalog.
    expect(
      throughput.perModel.map((m) => [m.modelName, m.tokensPerSecond]),
    ).toEqual([
      ["Small 1", 200],
      ["Big 1", 100],
    ]);
  });

  it("folds every agent bound to one model onto that model's rate", () => {
    // Three reviewers on the same model: the model's rate is what all three generated over
    // all three's model time (600 tokens in 3s), not any one instance's.
    const throughput = throughputOf([
      spawn("root", "root", "vendor/big"),
      generated("root", 100),
      timing("root", 2000),
      spawn("agent-0", "reviewer", "vendor/small", "root"),
      generated("agent-0", 100),
      timing("agent-0", 1000),
      spawn("agent-1", "reviewer", "vendor/small", "root"),
      generated("agent-1", 200),
      timing("agent-1", 1000),
      spawn("agent-2", "reviewer", "vendor/small", "root"),
      generated("agent-2", 300),
      timing("agent-2", 1000),
    ]);

    expect(
      throughput.perModel.map((m) => [
        m.modelId,
        m.generatedTokens,
        m.modelMs,
        m.tokensPerSecond,
      ]),
    ).toEqual([
      ["vendor/small", 600, 3000, 200],
      ["vendor/big", 100, 2000, 50],
    ]);
  });

  it("counts generation it cannot attribute to a model toward the rate anyway", () => {
    // An agent whose spawn was never recorded generated all the same. Its tokens and time
    // belong in the run's rate — they happened — but there is no model to file them under.
    const throughput = throughputOf([
      generated("root", 200),
      timing("root", 1000),
    ]);

    expect(throughput.overall).toBe(200);
    expect(throughput.perModel).toEqual([]);
  });

  it("states no rate at all when nothing was timed", () => {
    // Tokens with no model time behind them: a rate of zero would be a claim the stream
    // never made, so there is none.
    const throughput = throughputOf([
      spawn("root", "root", "vendor/big"),
      generated("root", 200),
    ]);

    expect(throughput.overall).toBeNull();
    expect(throughput.perModel).toEqual([]);
  });
});
