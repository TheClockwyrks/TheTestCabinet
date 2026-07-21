// Fuel-based ranking for PERFORMANCE test cases. A performance run is graded by
// the harness alone — correctness first, then the deterministic fuel a *correct*
// engine burned (lower is better) — so it carries no reviewer score the ordinary
// leaderboard could rank on. These helpers rank models by fuel instead, and place
// one run against that field, from the bounded case-scoped `RunSummary` set (the
// backend/snapshot lifts `performance` onto each card, so no full record is read).
//
// The board is PER-MODEL-BEST: each model appears once, at its lowest total fuel.
// Because fuel is deterministic, re-running the same engine posts the identical
// number; folding a model to its best keeps a model that was run many times from
// flooding the board or skewing a percentile. An individual run is still placed
// against that field (see `placeRunFuel`), so a worse duplicate can see where it
// stands — even relative to its own model's recorded best.

import type { RunSummary } from "@test-cabinet/run-record/snapshot";
import { canonicalModelId } from "../../modelId";

/** One model's best (lowest) total fuel on a single case + version + variant. */
export interface FuelEntry {
  /** Canonical (harness-aware) model id, so an `openrouter/`-prefixed or
   * `:free`-tagged run folds into one row with its base form. */
  modelId: string;
  /** Display name, resolved from the model catalog (falls back to the id). */
  modelName: string;
  /** The model's lowest total fuel across its correct runs — what it ranks on. */
  bestFuel: number;
  /** The id of the run that posted `bestFuel`, for linking to it. */
  bestRunId: string;
  /** How many correct, fuel-bearing runs of this model folded into the row. */
  runCount: number;
  /** The most recent contributing run's start time, for the recency tie-break. */
  latestStartedAt: string;
}

/** The comparability scope for a fuel board: fuel totals are only comparable
 * within one case slug + version + variant (the same scored scenario set). */
export interface FuelCohortScope {
  slug: string;
  version: string;
  variant: string;
}

/** Where one run's fuel lands in a per-model-best field. */
export interface RunPlacement {
  /** 1-based rank among the distinct models — `1 + (# models whose best beats
   * this run's fuel)`. A run worse than its own model's recorded best ranks
   * below that best. */
  rank: number;
  /** How many distinct models are in the field (correct runs only). */
  fieldSize: number;
  /** Fraction (0..1) of *other* models whose best this run beats, or `null` when
   * this run's model is the only one in the field. Excludes the run's own model
   * so a run is never compared against itself. */
  percentileBeaten: number | null;
  /** Whether this run is (tied for) its own model's best in the field. */
  isModelBest: boolean;
  /** This run's model's best fuel in the field (equal to the run's own fuel when
   * it is the model best). */
  modelBestFuel: number;
}

/** Whether a summary is a correct, fuel-bearing performance run — the only kind
 * that earns a fuel placement. */
function correctFuel(run: RunSummary): number | null {
  if (run.state !== "completed") return null;
  const perf = run.performance;
  if (!perf || !perf.correct || perf.totalFuel === null || perf.totalFuel === undefined) {
    return null;
  }
  return perf.totalFuel;
}

/**
 * Build the per-model-best fuel leaderboard for one case + version + variant:
 * each model with a correct performance run appears once at its lowest total
 * fuel, ranked ascending (lower is better; ties broken by earlier recency).
 * Failing runs and runs of other cases/versions/variants are excluded.
 */
export function perModelBestFuel(
  summaries: readonly RunSummary[],
  scope: FuelCohortScope,
  nameOf: (modelId: string, harnessSlug: string) => string,
): FuelEntry[] {
  const best = new Map<string, FuelEntry>();
  for (const run of summaries) {
    if (
      run.subject.testCaseSlug !== scope.slug ||
      run.subject.testCaseVersion !== scope.version ||
      run.subject.variant !== scope.variant
    ) {
      continue;
    }
    const fuel = correctFuel(run);
    if (fuel === null) continue;
    const modelId = canonicalModelId(run.subject.modelId, run.subject.harnessSlug);
    const existing = best.get(modelId);
    if (!existing) {
      best.set(modelId, {
        modelId,
        modelName: nameOf(run.subject.modelId, run.subject.harnessSlug),
        bestFuel: fuel,
        bestRunId: run.id,
        runCount: 1,
        latestStartedAt: run.startedAt,
      });
      continue;
    }
    existing.runCount += 1;
    if (fuel < existing.bestFuel) {
      existing.bestFuel = fuel;
      existing.bestRunId = run.id;
    }
    if (run.startedAt > existing.latestStartedAt) {
      existing.latestStartedAt = run.startedAt;
    }
  }
  return [...best.values()].sort(
    (a, b) =>
      a.bestFuel - b.bestFuel || a.latestStartedAt.localeCompare(b.latestStartedAt),
  );
}

/**
 * Place one run's fuel against a per-model-best field. The population is the
 * models' best efforts, so a model run many times does not skew the percentile;
 * the run is scored by how many *other* models' best it beats. `runModelId` must
 * be the run's canonical model id. Returns `null` for an empty field.
 */
export function placeRunFuel(
  fuel: number,
  runModelId: string,
  entries: readonly FuelEntry[],
): RunPlacement | null {
  if (entries.length === 0) return null;
  const modelEntry = entries.find((e) => e.modelId === runModelId);
  const others = entries.filter((e) => e.modelId !== runModelId);
  return {
    rank: entries.filter((e) => e.bestFuel < fuel).length + 1,
    fieldSize: entries.length,
    percentileBeaten:
      others.length === 0
        ? null
        : others.filter((e) => e.bestFuel > fuel).length / others.length,
    isModelBest: modelEntry ? fuel <= modelEntry.bestFuel : true,
    modelBestFuel: modelEntry ? modelEntry.bestFuel : fuel,
  };
}
