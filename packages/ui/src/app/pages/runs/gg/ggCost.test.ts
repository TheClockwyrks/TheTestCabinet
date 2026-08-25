// The per-model cost split of a gg run, and where its money went.
//
// A gg run binds one model per agent profile, so the money it spends is only legible
// when each token class is priced at the rate of the model that produced it. gg stamps
// every `usage` delta with the profile and model that spent it; these pin that the fold
// keeps that attribution, and that a run spanning several models therefore gets the same
// per-class split a single-model run does — from its first turn, not once its agents end.
//
// The same attribution answers *where* the money went, two ways: per profile (which role
// spent it, on which model) and per model (folded across the profiles one model is bound
// to). Those splits are pinned here too.

import { describe, expect, it } from "vitest";
import type {
  GgAgentConfig,
  GgCapabilitySet,
  GgTelemetryEvent,
  GgTelemetryKind,
} from "@test-cabinet/run-record/gg";
import type { HarnessEvent } from "../../../../client/types";
import type { ModelPrices } from "../../../data/models";
import {
  deriveGgCostBreakdown,
  deriveGgSpend,
  pricedSlots,
  type ModelNameLookup,
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
  profileId: string,
  modelId: string,
  tokens: { input?: number; cached?: number; output?: number; reason?: number },
  cost: number,
): HarnessEvent {
  return gg(agentId, {
    type: "usage",
    profileId,
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

// A run-level `slot_usage` rollup. gg emits these on the ROOT's stream once an agent has
// ended, and each one accounts for the whole run — not for the agent whose partition it
// lands in.
function rollup(
  profileId: string,
  modelId: string,
  tokens: { input?: number; output?: number },
  cost: number,
): HarnessEvent {
  return gg("root", {
    type: "slot_usage",
    profileId,
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
const NAMES: Record<string, string> = {
  "vendor/expensive": "Expensive 1",
  "vendor/cheap": "Cheap 1",
};
const nameOf: ModelNameLookup = (id) => NAMES[id] ?? null;

// The run's configuration as a run records it: launching resolved the profiles' internal
// ids away, so every profile here is named by the slug its telemetry is stamped with. This
// is what turns the profile id a rollup carries into the name a reader knows the arm by.
// Two of its profiles are called the same thing, which is legal and which is why the spend
// is accounted per slug.
function profile(slug: string, name: string, modelId: string): GgAgentConfig {
  return {
    slug,
    name,
    modelId,
    capabilities: [],
    openingTurn: { modules: [], functions: [] },
  };
}

const SET: GgCapabilitySet = {
  agents: [
    profile("root", "Root", "vendor/expensive"),
    profile("reviewer", "Reviewer", "vendor/cheap"),
    profile("reviewer-2", "Reviewer", "vendor/cheap"),
  ],
} as GgCapabilitySet;

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
      state.slotUsage.map((s) => [s.profileId, s.modelId, s.tokens, s.cost]),
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
      pricedSlots(state.slotUsage),
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

  it("splits where the money went per profile, naming each profile's model", () => {
    // Three profiles on two models, and two of them — an operator's pair of reviewers —
    // carry the same display name. That is why the split is kept per slug: folding on the
    // name would report one reviewer row that spent both reviewers' money, and folding on
    // it *only* here would leave the per-model row unable to say what the cheap model cost.
    const events = [
      spawn("root", "root", "vendor/expensive"),
      spawn("agent-0", "reviewer", "vendor/cheap", "root"),
      spawn("agent-1", "reviewer-2", "vendor/cheap", "root"),
      usage("root", "root", "vendor/expensive", { input: 1000 }, 1),
      usage("agent-0", "reviewer", "vendor/cheap", { input: 5000 }, 2),
      usage("agent-1", "reviewer-2", "vendor/cheap", { input: 2500 }, 3),
    ];
    const spend = deriveGgSpend(
      reduceGgEvents(events).slotUsage,
      SET,
      priceOf,
      nameOf,
    );

    // Per profile: costliest first, each carrying the slug it is accounted under, the name
    // that slug reads as, and the model it was bound to under the catalog's display name.
    // No row was priced from the catalog — the run reported its own costs.
    expect(
      spend.perProfile.map((row) => [
        row.profileId,
        row.profile,
        row.modelName,
        row.tokens,
        row.cost,
        row.derived,
      ]),
    ).toEqual([
      ["reviewer-2", "Reviewer", "Cheap 1", 2500, 3, false],
      ["reviewer", "Reviewer", "Cheap 1", 5000, 2, false],
      ["root", "Root", "Expensive 1", 1000, 1, false],
    ]);

    // Per model: the two cheap profiles fold into one row — the split that says the cheap
    // model, across both roles, outspent the expensive one.
    expect(
      spend.perModel.map((row) => [
        row.profileId,
        row.profile,
        row.modelId,
        row.tokens,
        row.cost,
      ]),
    ).toEqual([
      [null, null, "vendor/cheap", 7500, 5],
      [null, null, "vendor/expensive", 1000, 1],
    ]);
  });

  it("prices a spend row the run reported no cost for, and says it derived it", () => {
    // A harness that reports tokens but no dollars: the rows are priced from the catalog
    // so the bars are still real, and flagged as derived. An unpriced model reports no
    // cost at all rather than a misleading zero, and sorts last.
    const spend = deriveGgSpend(
      [
        {
          profileId: "root",
          modelId: "vendor/cheap",
          tokens: {
            uncachedInput: 5000,
            cachedInput: null,
            output: 100,
            reasoning: null,
          },
          cost: null,
        },
        {
          profileId: "helper",
          modelId: "vendor/unknown",
          tokens: {
            uncachedInput: 900,
            cachedInput: null,
            output: null,
            reasoning: null,
          },
          cost: null,
        },
      ],
      null,
      priceOf,
      nameOf,
    );
    expect(
      spend.perProfile.map((row) => [row.profileId, row.cost, row.derived]),
    ).toEqual([
      ["root", 5000 * 1e-7 + 100 * 1e-6, true],
      // Unknown to the catalog, so neither reported nor priceable.
      ["helper", null, false],
    ]);
    // The model name falls back to the id where the catalog does not know the model, and
    // a profile reads as its own slug where there is no configuration to name it by.
    expect(spend.perProfile[1]?.modelName).toBe("vendor/unknown");
    expect(spend.perProfile.map((row) => row.profile)).toEqual([
      "root",
      "helper",
    ]);
  });

  it("reports no spend split before the run has attributed anything", () => {
    expect(deriveGgSpend([], SET, priceOf, nameOf)).toEqual({
      perProfile: [],
      perModel: [],
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
