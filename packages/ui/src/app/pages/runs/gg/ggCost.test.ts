// The per-model cost split of a gg run.
//
// A gg run binds one model per agent profile, so the money it spends is only legible
// when each token class is priced at the rate of the model that produced it. gg stamps
// every `usage` delta with the profile and model that spent it; these pin that the fold
// keeps that attribution, that a run spanning several models therefore gets the same
// per-class split a single-model run does — from its first turn, not once its agents
// end — and that the pre-attribution streams still recorded fall back to something real
// rather than to "no breakdown".

import { describe, expect, it } from "vitest";
import type {
  GgTelemetryEvent,
  GgTelemetryKind,
} from "@test-cabinet/run-record/gg";
import type { HarnessEvent } from "../../../../client/types";
import type { ModelPrices } from "../../../data/models";
import {
  agentPricedSlots,
  deriveGgCostBreakdown,
  runPricedSlots,
  type ModelPriceLookup,
} from "./ggCost";
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

// A usage delta as gg emits it: attributed to the profile and model that spent it.
function usage(
  agentId: string,
  slot: string,
  modelId: string,
  tokens: { input?: number; cached?: number; output?: number; reason?: number },
  cost: number,
): HarnessEvent {
  return gg(agentId, {
    type: "usage",
    slot,
    modelId,
    tokens: {
      uncachedInput: tokens.input ?? null,
      cachedInput: tokens.cached ?? null,
      output: tokens.output ?? null,
      reasoning: tokens.reason ?? null,
    },
    cost: { comparable: cost, actual: cost },
  } as GgTelemetryKind);
}

// The same delta as a stream recorded before gg attributed its deltas carried it.
function bareUsage(
  agentId: string,
  tokens: { input?: number; output?: number },
  cost: number,
): HarnessEvent {
  return gg(agentId, {
    type: "usage",
    tokens: {
      uncachedInput: tokens.input ?? null,
      cachedInput: null,
      output: tokens.output ?? null,
      reasoning: null,
    },
    cost: { comparable: cost, actual: cost },
  } as GgTelemetryKind);
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

// A run-level `slot_usage` rollup. gg emits these on the ROOT's stream once an agent has
// ended, and each one accounts for the whole run — not for the agent whose partition it
// lands in.
function rollup(
  slot: string,
  modelId: string,
  tokens: { input?: number; output?: number },
  cost: number,
): HarnessEvent {
  return gg("root", {
    type: "slot_usage",
    slot,
    modelId,
    tokens: {
      uncachedInput: tokens.input ?? null,
      cachedInput: null,
      output: tokens.output ?? null,
      reasoning: null,
    },
    cost: { comparable: cost, actual: cost },
  } as GgTelemetryKind);
}

// A two-model catalog: an expensive primary and a cheap reviewer, priced far enough
// apart that a blanket single rate could not produce the same split.
const PRICES: Record<string, ModelPrices> = {
  "vendor/expensive": { uncachedInput: 1e-5, cachedInput: 1e-6, output: 1e-4 },
  "vendor/cheap": { uncachedInput: 1e-7, cachedInput: null, output: 1e-6 },
} as Record<string, ModelPrices>;
const priceOf: ModelPriceLookup = (id) => PRICES[id] ?? null;

describe("gg per-model cost", () => {
  it("splits a live multi-model run's cost from the attributed deltas alone", () => {
    // Two profiles on two models, mid-run: no agent has ended, so no `slot_usage`
    // rollup exists yet. This is exactly the state the Dashboard used to give up on.
    const events = [
      spawn("root", "root", "vendor/expensive"),
      spawn("agent-0", "reviewer", "vendor/cheap", "root"),
      usage(
        "root",
        "root",
        "vendor/expensive",
        { input: 1000, output: 200 },
        1,
      ),
      usage("agent-0", "reviewer", "vendor/cheap", { input: 5000 }, 2),
      usage("root", "root", "vendor/expensive", { cached: 400 }, 3),
    ];
    const state = reduceGgEvents(events);

    // The run's spend is split per (profile, model) live.
    expect(
      state.slotUsage.map((s) => [s.slot, s.modelId, s.tokens, s.cost]),
    ).toEqual([
      [
        "root",
        "vendor/expensive",
        {
          uncachedInput: 1000,
          cachedInput: 400,
          output: 200,
          reasoning: null,
        },
        { comparable: 4, actual: 4 },
      ],
      [
        "reviewer",
        "vendor/cheap",
        {
          uncachedInput: 5000,
          cachedInput: null,
          output: null,
          reasoning: null,
        },
        { comparable: 2, actual: 2 },
      ],
    ]);

    // …and prices per class, each at its own model's rate.
    const breakdown = deriveGgCostBreakdown(
      runPricedSlots(state.slotUsage, reduceGgEventsPerAgent(events), []),
      priceOf,
    );
    expect(breakdown).toEqual({
      // 1000 @ 1e-5 (expensive) + 5000 @ 1e-7 (cheap)
      input: 1000 * 1e-5 + 5000 * 1e-7,
      cachedInput: 400 * 1e-6,
      reasoning: 0,
      output: 200 * 1e-4,
      total: 1000 * 1e-5 + 5000 * 1e-7 + 400 * 1e-6 + 200 * 1e-4,
    });
  });

  it("keeps each agent's figures its own, and the run's rollups off any one agent", () => {
    // The root's stream carries the run-level rollups (as gg emits them) *and* the
    // root's own deltas. Crediting root with the rollups would report the whole
    // session's spend as the root agent's.
    const events = [
      spawn("root", "root", "vendor/expensive"),
      spawn("agent-0", "reviewer", "vendor/cheap", "root"),
      usage(
        "root",
        "root",
        "vendor/expensive",
        { input: 1000, output: 200 },
        1,
      ),
      usage("agent-0", "reviewer", "vendor/cheap", { input: 5000 }, 2),
      rollup("root", "vendor/expensive", { input: 1000, output: 200 }, 1),
      rollup("reviewer", "vendor/cheap", { input: 5000 }, 2),
    ];
    const perAgent = reduceGgEventsPerAgent(events);

    expect(perAgent.get("root")?.usage.totalTokens).toBe(1200);
    expect(perAgent.get("root")?.usage.comparable).toBe(1);
    expect(perAgent.get("root")?.slotUsage.map((s) => s.modelId)).toEqual([
      "vendor/expensive",
    ]);
    expect(perAgent.get("agent-0")?.usage.totalTokens).toBe(5000);
    expect(perAgent.get("agent-0")?.slotUsage.map((s) => s.modelId)).toEqual([
      "vendor/cheap",
    ]);

    // The run total is the two agents' partitions summed — no double count from the
    // rollups restating the same tokens.
    expect(reduceGgEvents(events).usage.totalTokens).toBe(6200);
    expect(reduceGgEvents(events).usage.comparable).toBe(3);
  });

  it("prices a pre-attribution multi-model stream agent by agent", () => {
    // A stream recorded before gg attributed its deltas: the models are known only
    // from each agent's spawn, and no rollup has arrived. Attributing each agent's own
    // tally to its own model still yields a real split.
    const events = [
      spawn("root", "root", "vendor/expensive"),
      spawn("agent-0", "reviewer", "vendor/cheap", "root"),
      bareUsage("root", { input: 1000, output: 200 }, 1),
      bareUsage("agent-0", { input: 5000 }, 2),
    ];
    const state = reduceGgEvents(events);
    expect(state.slotUsage).toEqual([]);

    const breakdown = deriveGgCostBreakdown(
      runPricedSlots(
        state.slotUsage,
        reduceGgEventsPerAgent(events),
        state.agentForest,
      ),
      priceOf,
    );
    expect(breakdown).toEqual({
      input: 1000 * 1e-5 + 5000 * 1e-7,
      cachedInput: 0,
      reasoning: 0,
      output: 200 * 1e-4,
      total: 1000 * 1e-5 + 5000 * 1e-7 + 200 * 1e-4,
    });
  });

  it("prices one agent from its own model when its deltas carry no attribution", () => {
    const events = [
      spawn("agent-0", "reviewer", "vendor/cheap", "root"),
      bareUsage("agent-0", { input: 5000, output: 100 }, 2),
    ];
    const state = reduceGgEventsPerAgent(events).get("agent-0")!;
    const slots = agentPricedSlots(
      state.slotUsage,
      state.usage,
      "vendor/cheap",
    );
    expect(deriveGgCostBreakdown(slots, priceOf)).toEqual({
      input: 5000 * 1e-7,
      cachedInput: 0,
      reasoning: 0,
      output: 100 * 1e-6,
      total: 5000 * 1e-7 + 100 * 1e-6,
    });
  });

  it("reports no breakdown only when nothing can be priced", () => {
    expect(deriveGgCostBreakdown([], priceOf)).toBeNull();
    expect(
      deriveGgCostBreakdown(
        [
          {
            modelId: "vendor/unknown",
            tokens: {
              uncachedInput: 100,
              cachedInput: null,
              output: 10,
              reasoning: null,
            },
          },
        ],
        priceOf,
      ),
    ).toBeNull();
  });
});
