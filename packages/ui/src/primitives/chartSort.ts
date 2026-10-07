// The order a chart's bars are drawn in, and the comparator that applies it.
//
// The vocabulary lives here rather than inside one widget because a page of
// charts answers to ONE control — switching the order on any chart switches
// every chart — so all of them have to mean the same thing by "best". A chart's
// own metric decides which direction that is (cheapest, fewest tokens, highest
// rating, most points); ties are split the same way everywhere, by the mean
// points earned.

/**
 * How a chart orders its bars.
 * - `alphabetical`: by label, so the roster stays a stable, findable list. This
 *   is what Plot does on its own with an inferred ordinal domain, and it is the
 *   default.
 * - `best`: best-first on the chart's own metric.
 */
export type ChartSort = "alphabetical" | "best";

/** Which end of a chart's metric counts as better under the `best` order. */
export type BetterIs = "lower" | "higher";

/**
 * The mean points earned by the bar with this label, or null when it has none.
 * Higher is better. It is the tie-break behind every `best` order, so two bars
 * that are level on the charted metric still land in a defensible order rather
 * than an arbitrary one.
 */
export type ChartTieBreak = (label: string) => number | null;

/**
 * Order a chart's bars, returning a new array (the caller's is left alone).
 * `value` is a bar's charted magnitude, or null when the metric is unknown for
 * it — an unmeasured bar sorts last however good its tie-break, since it has not
 * earned a place among the ones we can measure.
 */
export function orderBars<T>(
  bars: readonly T[],
  sort: ChartSort,
  label: (bar: T) => string,
  value: (bar: T) => number | null,
  betterIs: BetterIs,
  tieBreak?: ChartTieBreak,
): T[] {
  const ordered = [...bars];
  if (sort === "alphabetical") {
    return ordered.sort((a, b) => label(a).localeCompare(label(b)));
  }
  return ordered.sort((a, b) => {
    const byMetric = compareMetric(value(a), value(b), betterIs);
    if (byMetric !== 0) return byMetric;
    const byPoints = compareMetric(
      tieBreak?.(label(a)) ?? null,
      tieBreak?.(label(b)) ?? null,
      "higher",
    );
    if (byPoints !== 0) return byPoints;
    // Level on the metric AND on points: fall back to the label so the order is
    // at least deterministic rather than dependent on the input order.
    return label(a).localeCompare(label(b));
  });
}

// Orders two magnitudes best-first, with an unknown (null) value last in either
// direction — "unknown" is never better than a measured figure.
function compareMetric(
  a: number | null,
  b: number | null,
  betterIs: BetterIs,
): number {
  if (a === null) return b === null ? 0 : 1;
  if (b === null) return -1;
  return betterIs === "lower" ? a - b : b - a;
}
