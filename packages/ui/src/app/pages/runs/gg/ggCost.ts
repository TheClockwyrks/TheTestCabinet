// Per-class cost for a gg run, reconstructed from the model catalog's prices.
//
// gg records a *total* cost per accounting — a single USD figure, not a class-by-class
// split (see the run-record `CostMetrics` contract: `comparable` and `actual`, nothing
// more). To show what the money went to — input vs cached input vs reasoning vs output —
// and the input-vs-output cost ring, we price each token class against the per-token
// price of the model that produced it.
//
// A gg run spans several models (one per agent profile), so the pricing is per
// (profile, model) and summed, never one blanket rate over the run's tokens. gg stamps
// every `usage` delta with the profile and model that spent it, so that split is exact
// and available from the run's first turn; the priced units below are those per-(slot,
// model) tallies. Only a stream recorded before gg attributed its deltas needs the
// fallback — the scope's aggregate tally priced at the model its agent is bound to.
//
// The same per-(slot, model) tallies also carry *where* the money went, which this
// module derives as the two readings of one accounting: per slot (which role spent it)
// and per model (which model spent it, folded across the slots bound to it). See
// `deriveGgSpend`.
//
// Reasoning tokens are billed at the output rate (the catalog carries no separate
// reasoning price — see `TokenMetrics.reasoning`), so they take the output price.
// Cached input falls back to the uncached-input rate when the catalog lists no
// distinct cached price, rather than dropping those tokens from the split.

import { useMemo } from "react";
import type { CostMetrics, TokenMetrics } from "@test-cabinet/run-record";
import { useFindModelOptional } from "../../../data/useModels";
import type { ModelPrices } from "../../../data/models";
import {
  ROOT_ID,
  accumulateSlotUsage,
  type AgentTreeNode,
  type DerivedGgState,
  type SlotUsage,
  type UsageTally,
} from "./useGgRunState";

// A run's cost broken into the four token classes, in USD. The `total` is their
// sum — the derived total, which may differ slightly from the run's recorded
// `comparable` cost (prices move, and a single-provider harness may report its own
// exact figure), so a caller that has the authoritative total should show that and
// use these only for the *split*.
export interface GgCostBreakdown {
  /** Uncached input cost. */
  input: number;
  /** Cached-input cost (billed at a lower rate when the catalog lists one). */
  cachedInput: number;
  /** Reasoning cost, priced at the output rate. */
  reasoning: number;
  /** Non-reasoning output cost. */
  output: number;
  /** The four classes summed — the derived total. */
  total: number;
}

// Resolve a run's `modelId` to its per-token prices, or null when the model is
// unknown to the catalog or carries no price.
export type ModelPriceLookup = (modelId: string) => ModelPrices | null;

// Resolve a run's `modelId` to the catalog's display name for it, or null when the
// catalog is absent or does not know the model (the id then stands in).
export type ModelNameLookup = (modelId: string) => string | null;

// One priceable unit of a run's usage: a token count paired with the model that
// produced it, so each is priced at its own model's rate before summing.
export interface PricedSlot {
  tokens: TokenMetrics;
  modelId: string;
}

// Price each slot's token classes against its model and sum into a four-class
// breakdown. Returns null when nothing could be priced (no slot resolved to a
// price, or the priced total came to zero) so a caller can fall back to showing the
// total alone rather than an all-zero split.
export function deriveGgCostBreakdown(
  slots: readonly PricedSlot[],
  priceOf: ModelPriceLookup,
): GgCostBreakdown | null {
  const acc = { input: 0, cachedInput: 0, reasoning: 0, output: 0 };
  let priced = false;
  for (const slot of slots) {
    const prices = priceOf(slot.modelId);
    if (!prices) continue;
    const inputRate = prices.uncachedInput;
    // Fall back to the input rate when no distinct cached rate is listed, so cached
    // tokens are still costed rather than silently dropped from the split.
    const cachedRate = prices.cachedInput ?? prices.uncachedInput;
    const outputRate = prices.output;
    const { uncachedInput, cachedInput, output, reasoning } = slot.tokens;
    if (inputRate != null && uncachedInput) {
      acc.input += uncachedInput * inputRate;
      priced = true;
    }
    if (cachedRate != null && cachedInput) {
      acc.cachedInput += cachedInput * cachedRate;
      priced = true;
    }
    if (outputRate != null && output) {
      acc.output += output * outputRate;
      priced = true;
    }
    // Reasoning is billed as output.
    if (outputRate != null && reasoning) {
      acc.reasoning += reasoning * outputRate;
      priced = true;
    }
  }
  if (!priced) return null;
  const total = acc.input + acc.cachedInput + acc.reasoning + acc.output;
  if (total <= 0) return null;
  return { ...acc, total };
}

// A tally's token classes as a `TokenMetrics`, for pricing a scope whose usage is only
// an aggregate — a stream recorded before gg attributed its deltas.
function tokensFromTally(usage: UsageTally): TokenMetrics {
  return {
    uncachedInput: usage.uncachedInput,
    cachedInput: usage.cachedInput,
    output: usage.output,
    reasoning: usage.reasoning,
  };
}

/**
 * The priceable units of **one agent's** spend: its per-(slot, model) tallies, or — on a
 * stream whose deltas carry no attribution — its whole tally priced at the model its
 * agent is bound to, which for a single agent is exact.
 */
export function agentPricedSlots(
  slotUsage: readonly SlotUsage[],
  usage: UsageTally,
  modelId: string | null,
): PricedSlot[] {
  if (slotUsage.length > 0) return pricedSlots(slotUsage);
  if (!modelId || !usage.anyTokens) return [];
  return [{ tokens: tokensFromTally(usage), modelId }];
}

/**
 * The priceable units of a resolved per-`(slot, model)` rollup — every entry's tokens
 * paired with the model that produced them, so each is priced at its own model's rate.
 * Pair with {@link runSlotUsage} for a whole run.
 */
export function pricedSlots(slots: readonly SlotUsage[]): PricedSlot[] {
  return slots.map((s) => ({ tokens: s.tokens, modelId: s.modelId }));
}

/**
 * A **whole run's** per-`(slot, model)` usage, for the read-out of *where* its money
 * went.
 *
 * Prefers the run's own split, which gg's attributed `usage` deltas make available from
 * the first turn. A stream whose deltas carry no attribution is instead rolled up agent
 * by agent — each agent's own tally under the slot and model its `agent_spawned` bound
 * it to, with agents sharing a `(slot, model)` summed into one entry — so the split
 * still reads *while the run happens* rather than only once agents end and stream the
 * `slot_usage` rollups. That per-agent pass is the partition of the run, so it neither
 * double-counts nor drops anyone's spend.
 */
export function runSlotUsage(
  slotUsage: readonly SlotUsage[],
  perAgent: Map<string, DerivedGgState>,
  agentForest: readonly AgentTreeNode[],
): SlotUsage[] {
  if (slotUsage.length > 0) return [...slotUsage];
  // First-seen `(slot, model)` order, so the fallback lists the run's slots in the order
  // the run introduced them.
  const byKey = new Map<string, SlotUsage>();
  const add = (
    slot: string,
    modelId: string,
    tokens: TokenMetrics,
    cost: CostMetrics | null,
  ) => {
    const key = `${slot} ${modelId}`;
    let entry = byKey.get(key);
    if (!entry) {
      entry = {
        slot,
        modelId,
        tokens: {
          uncachedInput: null,
          cachedInput: null,
          output: null,
          reasoning: null,
        },
        cost: null,
      };
      byKey.set(key, entry);
    }
    accumulateSlotUsage(entry, tokens, cost);
  };
  const walk = (node: AgentTreeNode) => {
    const state = perAgent.get(node.id);
    if (state) {
      if (state.slotUsage.length > 0) {
        // This agent's deltas *were* attributed; take them as they are.
        for (const s of state.slotUsage)
          add(s.slot, s.modelId, s.tokens, s.cost);
      } else if (node.modelId && state.usage.anyTokens) {
        // They were not: the agent's own tally belongs wholly to the slot and model its
        // spawn bound it to. An agent whose spawn named no slot (the main agent, which
        // is never spawned) reads under its own id, the same name it carries everywhere
        // else.
        add(
          node.slot ?? (node.id === ROOT_ID ? "root" : node.id),
          node.modelId,
          tokensFromTally(state.usage),
          state.usage.comparable == null && state.usage.actual == null
            ? null
            : {
                comparable: state.usage.comparable,
                actual: state.usage.actual,
              },
        );
      }
    }
    node.children.forEach(walk);
  };
  agentForest.forEach(walk);
  return [...byKey.values()];
}

/**
 * The cost breakdown for `slots`, priced against the loaded model catalog. Returns null
 * when the catalog is absent (no gallery provider) or nothing could be priced.
 */
export function useGgCostBreakdown(
  slots: readonly PricedSlot[],
): GgCostBreakdown | null {
  const findModel = useFindModelOptional();
  return useMemo(() => {
    if (!findModel) return null;
    const priceOf: ModelPriceLookup = (id) => findModel(id)?.prices ?? null;
    return deriveGgCostBreakdown(slots, priceOf);
  }, [findModel, slots]);
}

// --- Where the money went: per slot, and per model ---------------------------

/**
 * One row of a spend breakdown: what a slot — or, folded across slots, a model — spent.
 *
 * A run's cost is accounted per `(slot, model)` pair, and the two questions that pair
 * answers are different ones: *which role* the money went to (is the reviewer slot
 * costing more than the builder?) and *which model* it went to (a run may bind the same
 * model to several slots, so a per-slot read alone never says what one model cost).
 */
export interface SpendRow {
  /** A stable react key: `"<slot> <modelId>"` per slot, the model id per model. */
  key: string;
  /** The slot this row accounts for; null on a per-model row. */
  slot: string | null;
  /** The model that spent it — on a per-slot row, the model bound to that slot. */
  modelId: string;
  /** The catalog's display name for {@link modelId}, or the id where it is unknown. */
  modelName: string;
  /** Every reported token class summed — the row's token total. */
  tokens: number;
  /**
   * The row's cost in USD: the figure the run reported for it, or — where it reported
   * none — the row's tokens priced against the catalog. Null when neither is available
   * (an unpriced model on a run that reported no cost).
   */
  cost: number | null;
  /** Whether {@link cost} was priced from the catalog rather than reported by the run. */
  derived: boolean;
}

/** A run's spend, split the two ways a `(slot, model)` accounting can be read. */
export interface GgSpendBreakdown {
  /** One row per `(slot, model)` the run touched, costliest first. */
  perSlot: SpendRow[];
  /**
   * The same spend folded onto the models that did it, costliest first. Shorter than
   * {@link perSlot} exactly when some model is bound to more than one slot — which is
   * the case this split exists for.
   */
  perModel: SpendRow[];
}

// Sum a `(slot, model)` rollup's reported token classes into one figure.
function totalTokens(tokens: TokenMetrics): number {
  return (
    (tokens.uncachedInput ?? 0) +
    (tokens.cachedInput ?? 0) +
    (tokens.output ?? 0) +
    (tokens.reasoning ?? 0)
  );
}

// Costliest first, so the bars descend and the run's biggest spender leads. Rows with
// no cost at all sort last (by tokens), rather than jumping the queue as a zero.
function bySpendDescending(a: SpendRow, b: SpendRow): number {
  if (a.cost != null && b.cost != null && a.cost !== b.cost)
    return b.cost - a.cost;
  if (a.cost == null && b.cost != null) return 1;
  if (a.cost != null && b.cost == null) return -1;
  return b.tokens - a.tokens;
}

/**
 * Split a run's per-`(slot, model)` usage into the per-slot and per-model spend
 * breakdowns, pricing any row the run reported no cost for against the catalog so a
 * harness that reports tokens but not dollars still gets real bars.
 */
export function deriveGgSpend(
  slotUsage: readonly SlotUsage[],
  priceOf: ModelPriceLookup,
  nameOf: ModelNameLookup,
): GgSpendBreakdown {
  const perSlot = slotUsage.map((usage): SpendRow => {
    const reported = usage.cost?.comparable ?? null;
    const priced =
      reported == null
        ? (deriveGgCostBreakdown(
            [{ tokens: usage.tokens, modelId: usage.modelId }],
            priceOf,
          )?.total ?? null)
        : null;
    return {
      key: `${usage.slot} ${usage.modelId}`,
      slot: usage.slot,
      modelId: usage.modelId,
      modelName: nameOf(usage.modelId) ?? usage.modelId,
      tokens: totalTokens(usage.tokens),
      cost: reported ?? priced,
      derived: reported == null && priced != null,
    };
  });

  // Fold onto the models, preserving each model's first-seen order before the sort so
  // an unpriced run (every row null) still reads in a stable order.
  const perModel = new Map<string, SpendRow>();
  for (const row of perSlot) {
    const at = perModel.get(row.modelId);
    if (!at) {
      perModel.set(row.modelId, { ...row, key: row.modelId, slot: null });
      continue;
    }
    at.tokens += row.tokens;
    if (row.cost != null) at.cost = (at.cost ?? 0) + row.cost;
    at.derived = at.derived || row.derived;
  }

  return {
    perSlot: [...perSlot].sort(bySpendDescending),
    perModel: [...perModel.values()].sort(bySpendDescending),
  };
}

/**
 * A run's spend broken down per slot and per model, priced against the loaded model
 * catalog (which also supplies each model's display name). Empty when the run has not
 * yet attributed any usage.
 */
export function useGgSpend(slotUsage: readonly SlotUsage[]): GgSpendBreakdown {
  const findModel = useFindModelOptional();
  return useMemo(
    () =>
      deriveGgSpend(
        slotUsage,
        (id) => findModel?.(id)?.prices ?? null,
        (id) => findModel?.(id)?.name ?? null,
      ),
    [findModel, slotUsage],
  );
}
