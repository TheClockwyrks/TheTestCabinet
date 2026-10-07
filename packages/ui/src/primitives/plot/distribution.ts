// The honest summary of a small sample, computed in the browser from the raw
// per-run values a chart is already holding.
//
// The comparisons surface takes its statistics from the backend
// (`crates/core/src/comparison_stats.rs`) because a published comparison is a
// document and must render identically every time it is read. A per-test-case
// metric chart has no such document: it folds whatever runs the reader has
// scoped, live, in the browser. The spread behind one of its mean bars therefore
// has to be computed here — and computed the *same way*, or two views of one set
// of runs would disagree about where a quartile sits.
//
// What is deliberately absent is the bootstrap confidence interval on the median
// that `MetricSummary` carries. Ten thousand resamples per group, recomputed
// whenever the reader re-scopes the page, is not work a hover affordance should
// do, and `DistributionGroup.ciLow` already documents the honest rendering of
// "no interval": no mark at all, never a zero-width one at the median. The box,
// the whiskers, the median and `n` are unaffected.
//
// See [the statistics methodology](/comparisons/statistics/).

/**
 * The summary statistics behind an aggregated figure. A field-for-field subset
 * of `MetricSummary` (`@clockwyrks/run-record/comparison`) minus the bootstrap
 * interval, so one of these spreads straight into a
 * {@link ./charts!DistributionGroup}.
 */
export interface DistributionStats {
  /** How many observations the summary is over. Always shown, never implied. */
  n: number;
  /** The arithmetic mean — what is actually paid, averaged over the runs. */
  mean: number;
  /** The median: the honest typical run for a right-skewed metric. */
  median: number;
  min: number;
  max: number;
  /** The 25th percentile, the box's lower edge. */
  q1: number;
  /** The 75th percentile, the box's upper edge. */
  q3: number;
}

/**
 * The repository's one linearly interpolated quantile, over an **already
 * sorted** sample. Mirrors `crate::comparison_stats::quantile` (and its browser
 * twin in the gg query evaluator) so every box plot in the app cuts its
 * quartiles at the same place.
 *
 * With a single observation the sample has no spread and every quantile is that
 * observation — the distribution collapses to a point, which is what the
 * statistics methodology says it should do rather than fabricating a width.
 */
export function quantile(sorted: readonly number[], q: number): number {
  const n = sorted.length;
  if (n === 0) return Number.NaN;
  if (n === 1) return sorted[0]!;
  const clamped = Math.min(1, Math.max(0, q));
  // Rank position in [0, n-1]; the fractional part interpolates between neighbours.
  const pos = clamped * (n - 1);
  const lower = Math.floor(pos);
  const upper = Math.ceil(pos);
  if (lower === upper) return sorted[lower]!;
  const weight = pos - lower;
  return sorted[lower]! * (1 - weight) + sorted[upper]! * weight;
}

/**
 * Summarize a sample. Returns null for an empty one — a view then says "no
 * runs" rather than drawing a fabricated zero.
 *
 * The caller's array is left alone (a chart's per-run values are shared with
 * whatever else is reading them).
 */
export function summarizeValues(
  values: readonly number[],
): DistributionStats | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((total, value) => total + value, 0);
  return {
    n: sorted.length,
    mean: sum / sorted.length,
    median: quantile(sorted, 0.5),
    min: sorted[0]!,
    max: sorted[sorted.length - 1]!,
    q1: quantile(sorted, 0.25),
    q3: quantile(sorted, 0.75),
  };
}
