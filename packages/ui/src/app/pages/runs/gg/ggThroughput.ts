// How fast a gg run generates — its tokens per second, per model and over the run.
//
// gg records the two halves of that rate apart. A turn's wall-clock arrives as
// `turn_timing`, whose `requestMs` is the model call itself (the same latency the turn's
// `prompt` carries as `durationMs`), and its tokens arrive as the `usage` deltas folded
// into each agent's tally. Pairing them per agent is what makes the rate attributable to a
// *model*: an agent runs on exactly one model — the one its spawn bound it to — so its
// generation and its model time both belong to that model, and agents sharing a model fold
// together.
//
// The run's overall rate is its total generation over its total model time, not the mean of
// the per-model rates. A run whose main agent grinds out 40 tok/s while a one-call
// summarizer hits 300 generates at 40-something; averaging the two rates would claim it ran
// at 170. Generation an agent's stream never attributed to a model (a spawn recorded before
// gg named its model) still counts toward that overall rate — it happened — it simply has no
// per-model row to sit in.

import { useMemo } from "react";
import { useFindModelOptional } from "../../../data/useModels";
import type { ModelNameLookup } from "./ggCost";
import type {
  AgentTreeNode,
  DerivedGgState,
  UsageTally,
} from "./useGgRunState";

const throughputFmt = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});

/**
 * A generation rate as a bare figure, for a card that carries its own "tok/s" unit.
 * Whole tokens per second: the fractions of a rate this size say nothing.
 */
export function formatThroughputValue(tokensPerSecond: number): string {
  return throughputFmt.format(tokensPerSecond);
}

/** A generation rate with its unit, for a tooltip, a chip, or an axis label. */
export function formatThroughput(tokensPerSecond: number): string {
  return `${formatThroughputValue(tokensPerSecond)} tok/s`;
}

/** What one model generated, and how fast — folded across every agent bound to it. */
export interface GgModelThroughput {
  modelId: string;
  /** The catalog's display name for {@link modelId}, or the id where it is unknown. */
  modelName: string;
  /** Everything the model produced: output plus any separately-reported reasoning. */
  generatedTokens: number;
  /** Milliseconds spent inside its model calls — the rate's denominator. */
  modelMs: number;
  tokensPerSecond: number;
}

/** A run's generation rate, per model and as a whole. */
export interface GgThroughput {
  /** One row per model the run timed a call on, fastest first. */
  perModel: GgModelThroughput[];
  /** Every agent's generated tokens, whether or not their model could be named. */
  generatedTokens: number;
  /** Every agent's model time, likewise. */
  modelMs: number;
  /**
   * The run's generation over its model time — the average across every model it used.
   * Null when the run has not timed a model call yet, so a card reads empty rather than
   * claiming a rate of zero.
   */
  overall: number | null;
}

/**
 * Everything a scope produced: output plus any separately-reported reasoning, which is
 * generated all the same (the same numerator the per-request throughput metric plots).
 */
export function generatedTokens(usage: UsageTally): number {
  return usage.output + usage.reasoning;
}

// The milliseconds one agent spent waiting on its model. Summed from `turn_timing`, which
// gg emits once per turn whatever the run's capabilities — so the rate is available on
// every run, not only one that logged its prompts.
export function agentModelMs(state: DerivedGgState): number {
  let ms = 0;
  for (const timing of state.turnTimings) ms += timing.requestMs;
  return ms;
}

/**
 * One agent instance's own generation rate — everything it produced over the time it spent
 * inside its model calls, across every call it made. Null when none of its calls were timed,
 * so a read-out shows nothing rather than a rate of zero.
 *
 * The same accounting the run-wide rate is built from ({@link deriveGgThroughput}), narrowed
 * to one instance: an instance runs on exactly one model, so this *is* that model's rate as
 * this instance experienced it.
 */
export function agentThroughput(state: DerivedGgState): number | null {
  const ms = agentModelMs(state);
  return ms > 0 ? generatedTokens(state.usage) / (ms / 1000) : null;
}

/**
 * Fold a run's agents into its generation rate — see the module docs. `nameOf` resolves the
 * model catalog for the per-model rows' display names; without it a model reads by its id.
 */
export function deriveGgThroughput(
  agentForest: readonly AgentTreeNode[],
  perAgent: ReadonlyMap<string, DerivedGgState>,
  nameOf: ModelNameLookup,
): GgThroughput {
  const byModel = new Map<string, GgModelThroughput>();
  let totalTokens = 0;
  let totalMs = 0;

  const walk = (node: AgentTreeNode) => {
    const state = perAgent.get(node.id);
    if (state) {
      const tokens = generatedTokens(state.usage);
      const ms = agentModelMs(state);
      totalTokens += tokens;
      totalMs += ms;
      if (node.modelId != null) {
        let row = byModel.get(node.modelId);
        if (!row) {
          row = {
            modelId: node.modelId,
            modelName: nameOf(node.modelId) ?? node.modelId,
            generatedTokens: 0,
            modelMs: 0,
            tokensPerSecond: 0,
          };
          byModel.set(node.modelId, row);
        }
        row.generatedTokens += tokens;
        row.modelMs += ms;
      }
    }
    node.children.forEach(walk);
  };
  agentForest.forEach(walk);

  const perModel = [...byModel.values()]
    // A model whose calls were never timed has no rate to state — dropped rather than
    // listed at zero, the same way an untimed request is skipped by the metric graph.
    .filter((row) => row.modelMs > 0)
    .map((row) => ({
      ...row,
      tokensPerSecond: row.generatedTokens / (row.modelMs / 1000),
    }))
    // Fastest first, so the run's quickest model leads; the id breaks a tie so the order
    // is stable across renders.
    .sort(
      (a, b) =>
        b.tokensPerSecond - a.tokensPerSecond ||
        a.modelId.localeCompare(b.modelId),
    );

  return {
    perModel,
    generatedTokens: totalTokens,
    modelMs: totalMs,
    overall: totalMs > 0 ? totalTokens / (totalMs / 1000) : null,
  };
}

/**
 * A run's generation rate, with its per-model rows named from the loaded model catalog. The
 * catalog is optional — a console with no gallery provider still gets every rate, with each
 * model reading by its id.
 */
export function useGgThroughput(
  agentForest: readonly AgentTreeNode[],
  perAgent: ReadonlyMap<string, DerivedGgState>,
): GgThroughput {
  const findModel = useFindModelOptional();
  return useMemo(
    () =>
      deriveGgThroughput(
        agentForest,
        perAgent,
        (id) => findModel?.(id)?.name ?? null,
      ),
    [agentForest, perAgent, findModel],
  );
}
