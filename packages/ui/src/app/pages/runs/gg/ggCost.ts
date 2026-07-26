// Per-class cost for a gg run, reconstructed from the model catalog's prices.
//
// gg records only a *total* cost per run (and per slot) — a single USD figure, not
// a class-by-class split (see the run-record `CostMetrics` contract: `comparable`
// and `actual`, nothing more). To show what the money went to — input vs cached
// input vs reasoning vs output — and the input-vs-output cost ring, we price each
// token class against the per-token price of the model that produced it. A gg run
// can span several models (one per slot), so the pricing is per slot and summed,
// not one blanket rate over the run's tokens.
//
// Reasoning tokens are billed at the output rate (the catalog carries no separate
// reasoning price — see `TokenMetrics.reasoning`), so they take the output price.
// Cached input falls back to the uncached-input rate when the catalog lists no
// distinct cached price, rather than dropping those tokens from the split.

import { useMemo } from "react";
import type { TokenMetrics } from "@test-cabinet/run-record";
import type { GgCapabilitySet } from "@test-cabinet/run-record/gg";
import { useFindModelOptional } from "../../../data/useModels";
import type { ModelPrices } from "../../../data/models";
import type { SlotUsage, UsageTally } from "./useGgRunState";

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
interface PricedSlot {
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

// A tally's token classes as a `TokenMetrics`, for pricing a scope (the whole run,
// or one agent) that has an aggregate tally but no per-slot rollup yet.
function tokensFromTally(usage: UsageTally): TokenMetrics {
  return {
    uncachedInput: usage.uncachedInput,
    cachedInput: usage.cachedInput,
    output: usage.output,
    reasoning: usage.reasoning,
  };
}

// The single model a run's usage can be attributed to when there is no per-slot
// rollup to attribute it precisely — the sole slot's model, or the one every slot
// shares. Null when the run binds several distinct models (then an aggregate tally
// cannot be split by model, so no fallback breakdown is derivable) or when the set
// is not yet known.
export function soleModelId(set: GgCapabilitySet | null): string | null {
  if (!set || set.slots.length === 0) return null;
  const ids = new Set(set.slots.map((s) => s.modelId));
  return ids.size === 1 ? [...ids][0]! : null;
}

/**
 * The cost breakdown for one scope of a gg run, priced against the loaded model
 * catalog. Prefers the per-(slot, model) rollups (`slotUsage`) — the precise,
 * multi-model-aware source — and falls back to the scope's aggregate tally priced
 * at a single model when no rollup has arrived yet (a live run before its first
 * `slot_usage`, or a subagent whose usage is only a tally). Returns null when the
 * catalog is absent (no gallery provider) or nothing could be priced.
 */
export function useGgCostBreakdown(
  slotUsage: readonly SlotUsage[],
  fallbackUsage: UsageTally,
  fallbackModelId: string | null,
): GgCostBreakdown | null {
  const findModel = useFindModelOptional();
  return useMemo(() => {
    if (!findModel) return null;
    const priceOf: ModelPriceLookup = (id) => findModel(id)?.prices ?? null;
    const slots: PricedSlot[] =
      slotUsage.length > 0
        ? slotUsage.map((s) => ({ tokens: s.tokens, modelId: s.modelId }))
        : fallbackModelId && fallbackUsage.anyTokens
          ? [
              {
                tokens: tokensFromTally(fallbackUsage),
                modelId: fallbackModelId,
              },
            ]
          : [];
    return deriveGgCostBreakdown(slots, priceOf);
  }, [findModel, slotUsage, fallbackUsage, fallbackModelId]);
}
