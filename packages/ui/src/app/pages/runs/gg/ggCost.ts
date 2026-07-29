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
// Reasoning tokens are billed at the output rate (the catalog carries no separate
// reasoning price — see `TokenMetrics.reasoning`), so they take the output price.
// Cached input falls back to the uncached-input rate when the catalog lists no
// distinct cached price, rather than dropping those tokens from the split.

import { useMemo } from "react";
import type { TokenMetrics } from "@test-cabinet/run-record";
import { useFindModelOptional } from "../../../data/useModels";
import type { ModelPrices } from "../../../data/models";
import type {
  AgentTreeNode,
  DerivedGgState,
  SlotUsage,
  UsageTally,
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
  if (slotUsage.length > 0) {
    return slotUsage.map((s) => ({ tokens: s.tokens, modelId: s.modelId }));
  }
  if (!modelId || !usage.anyTokens) return [];
  return [{ tokens: tokensFromTally(usage), modelId }];
}

/**
 * The priceable units of a **whole run's** spend.
 *
 * Prefers the run's own per-(slot, model) split, which gg's attributed `usage` deltas
 * make available from the first turn. A stream recorded before that attribution existed
 * is instead priced agent by agent — each agent's own tally at the model its
 * `agent_spawned` bound it to — so a run spanning several models still gets a real
 * split rather than being written off as unattributable. That per-agent pass is the
 * partition of the run (gg stamps every event with the agent that emitted it), so it
 * neither double-counts nor drops anyone's spend.
 */
export function runPricedSlots(
  slotUsage: readonly SlotUsage[],
  perAgent: Map<string, DerivedGgState>,
  agentForest: readonly AgentTreeNode[],
): PricedSlot[] {
  if (slotUsage.length > 0) {
    return slotUsage.map((s) => ({ tokens: s.tokens, modelId: s.modelId }));
  }
  const slots: PricedSlot[] = [];
  const walk = (node: AgentTreeNode) => {
    const state = perAgent.get(node.id);
    if (state) {
      slots.push(
        ...agentPricedSlots(state.slotUsage, state.usage, node.modelId),
      );
    }
    node.children.forEach(walk);
  };
  agentForest.forEach(walk);
  return slots;
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
