// **Which chart a TCQ result gets** — the whole decision, as one pure function, so
// it can be argued with and tested without a DOM.
//
// The choice is not a preference and there is no chart picker. A `stats` stage
// already says what shape the answer has: how many buckets there are, whether the
// first group key is a date histogram or an ordinary field, and whether a column is
// a scalar or a `dist()`. Reading the form off the query rather than off a toggle
// means a link someone pastes draws the same picture for them as it did for the
// person who sent it, and it means there is no way to ask for a chart the data
// cannot honestly support.
//
// The rules, and why each one is here:
//
// - **One bucket, scalar columns → stat tiles, not a one-bar chart.** A single bar
//   encodes a magnitude against nothing. The figure is the answer; a bar is a
//   decoration around it that invites a comparison there is no second party to.
// - **A date-histogram first key → a line over a UTC time axis.** Buckets are
//   instants with an intrinsic order, and TCQ's evaluator already returns a date
//   histogram key-ascending for exactly this reason. `timeSeriesChart` re-sorts
//   anyway, so a histogram nested under a second group key — or any future change
//   to bucket ordering — still draws left-to-right in time instead of zigzagging.
// - **An ordinary field key → bars in a single hue.** Identity is on the axis, so
//   color has no work to do; spending a categorical hue on it would imply a series
//   relationship between unrelated categories.
// - **Two keys stack only when the aggregation is additive.** `count()` and `sum()`
//   stack because their parts sum to the whole. An average, a median, a p90 or a
//   `min` do not: stacking them draws a total that is not a number of anything.
//   Those fall back to a flat bar per composite key, which claims nothing.
// - **`dist()` → box plots**, which is the form the five-number summary *is*.
// - **Two aggregations become two charts, never a dual axis.** One chart per
//   column, stacked down the panel. Two y-scales in one frame let a reader "see" a
//   crossover that is an artifact of two arbitrary scalings.
// - **An absent value is dropped, never charted as zero.** The bucket table renders
//   it as an em dash for the same reason: a run that produced no cost is not a run
//   that cost nothing, and a fabricated zero drags every average through it. The
//   panel says how many rows it dropped rather than losing them silently.
//
// Everything a chart refuses to draw — a dropped row, a bucket past the cap, a
// series past the palette — is counted and reported, because the table view sitting
// beside the chart has all of it and a chart that quietly shows a subset is worse
// than one that says so.
import type {
  GgAggColumn,
  GgAggValue,
  GgBucket,
  GgDistribution,
  GgGroupKey,
} from "@clockwyrks/run-record/gg-query";
import type {
  BarPoint,
  DistributionGroup,
  StackedBarSegment,
  StackedSeries,
  TimeSeriesPoint,
} from "@clockwyrks/ui";
import { CATEGORICAL_COLORS, categoricalColor } from "@clockwyrks/ui";
import { compareCodePoints } from "../query";
import {
  ABSENT,
  formatAggValue,
  formatBucketKey,
  formatTimestamp,
} from "./cells";

/**
 * The most bars one chart draws.
 *
 * Past this the axis is a smear and the table is the better surface — and since a
 * non-histogram result comes back count descending, the bars kept are the largest
 * ones, which is the read anyone scrolling a bar chart was going to take anyway.
 */
export const MAX_BARS = 24;

/**
 * The most boxes one distribution chart draws.
 *
 * Lower than {@link MAX_BARS} because a box plot is five marks and a scatter of
 * points wide, not one rectangle; two dozen of them overlap into noise.
 */
export const MAX_BOXES = 12;

/**
 * The most series one chart colors.
 *
 * Exactly the categorical palette's length, because the palette is never cycled —
 * a seventh series would either repeat a validated hue (two entities, one color) or
 * invent an unvalidated one. Neither is acceptable, so the seventh series is left
 * out and counted instead.
 */
export const MAX_SERIES = CATEGORICAL_COLORS.length;

/** What one chart declined to draw, so the panel can say so instead of quietly
 *  showing a subset. Every field is a count of rows the table still has. */
export interface GgVizNote {
  /** Buckets whose value for this column was absent — dropped, never drawn as 0. */
  dropped: number;
  /** Buckets past the chart's cap. */
  hiddenBuckets: number;
  /** Series past {@link MAX_SERIES}. */
  hiddenSeries: number;
  /** The buckets that were drawn. */
  shown: number;
}

/** One labelled figure, for the single-bucket case where a chart would encode a
 *  magnitude against nothing. */
export interface GgVizTile {
  label: string;
  value: string;
  /**
   * The denominator as `"3/12"`, present exactly when fewer of the bucket's
   * documents contributed than it holds — the same rule the bucket table applies to
   * a cell, and for the same reason. TCQ has no `rate()` function because averaging
   * a boolean *is* a rate, and what makes that safe is that a view always says how
   * many documents carried the field. It is rendered **beside the label**, not in a
   * tooltip: a figure whose denominator is only discoverable on hover is a figure
   * most readers will take at face value.
   */
  denominator?: string;
  /** The denominator spelled out, for the tile's native tooltip. */
  hint?: string;
}

/** A visualization the panel should render. One per aggregated column, except for
 *  the tiles, which collapse a single bucket's scalar columns into one row. */
export type GgViz =
  | { kind: "tiles"; tiles: readonly GgVizTile[] }
  | {
      kind: "series";
      title: string;
      yLabel: string;
      points: readonly TimeSeriesPoint[];
      series: readonly StackedSeries[];
      format: (value: number) => string;
      note: GgVizNote;
    }
  | {
      kind: "bars";
      title: string;
      yLabel: string;
      points: readonly BarPoint[];
      format: (value: number) => string;
      note: GgVizNote;
    }
  | {
      kind: "stacked";
      title: string;
      yLabel: string;
      segments: readonly StackedBarSegment[];
      series: readonly StackedSeries[];
      format: (value: number) => string;
      note: GgVizNote;
    }
  | {
      kind: "distribution";
      title: string;
      yLabel: string;
      groups: readonly DistributionGroup[];
      format: (value: number) => string;
      note: GgVizNote;
    };

/**
 * Choose the visualizations for one aggregated result.
 *
 * Returns an empty list for anything that has no honest picture — no columns (the
 * document view), no buckets, or a result whose every value is absent.
 */
export function chooseVisualizations(
  buckets: readonly GgBucket[],
  columns: readonly GgAggColumn[],
  groupBy: readonly GgGroupKey[] = [],
): GgViz[] {
  if (columns.length === 0 || buckets.length === 0) return [];

  const vizzes: GgViz[] = [];
  const tiles: GgVizTile[] = [];
  // The grand-total bucket of an ungrouped `stats`, or a group-by that happened to
  // collapse to one row: either way there is nothing to compare a bar against.
  const single = buckets.length === 1;

  for (const column of columns) {
    const format = (value: number) =>
      formatAggValue(column.func, column.field, value);

    if (column.func === "dist") {
      const viz = distributionViz(buckets, column, groupBy, format);
      if (viz) vizzes.push(viz);
      continue;
    }

    if (single) {
      const tile = scalarTile(buckets[0]!, column, format);
      if (tile) tiles.push(tile);
      continue;
    }

    const viz = isHistogram(groupBy, 0)
      ? seriesViz(buckets, column, groupBy, format)
      : barViz(buckets, column, groupBy, format);
    if (viz) vizzes.push(viz);
  }

  // Tiles lead: they are the headline figure, and a `dist()` chart under them reads
  // as the detail behind it.
  return tiles.length ? [{ kind: "tiles", tiles }, ...vizzes] : vizzes;
}

// --- The four forms ------------------------------------------------------------

/** The single-bucket case: the figure itself, with its denominator when the whole
 *  bucket did not contribute. An absent figure yields no tile — a tile reading "—"
 *  is the table's job, and the panel is not the record. */
function scalarTile(
  bucket: GgBucket,
  column: GgAggColumn,
  format: (value: number) => string,
): GgVizTile | null {
  const value = valueOf(bucket, column);
  if (value?.value === undefined) return null;
  const partial = value.contributing < bucket.n;
  return {
    label: column.name,
    value: format(value.value),
    denominator: partial ? `${value.contributing}/${bucket.n}` : undefined,
    hint: partial
      ? `${value.contributing} of ${bucket.n} runs carried this field`
      : `${bucket.n} ${bucket.n === 1 ? "run" : "runs"}`,
  };
}

/** A date histogram: one line per second-key value (or one unnamed line), plotted
 *  against real instants. */
function seriesViz(
  buckets: readonly GgBucket[],
  column: GgAggColumn,
  groupBy: readonly GgGroupKey[],
  format: (value: number) => string,
): GgViz | null {
  const keyed = drawable(buckets, column);
  const series = seriesRoster(keyed.rows, groupBy);

  const points: TimeSeriesPoint[] = [];
  let hiddenBuckets = 0;
  for (const row of keyed.rows) {
    const at = row.bucket.key[0]?.value;
    // A histogram key that is not a number cannot sit on a time axis: the bucket
    // whose documents all *lack* the bucketed field has no instant to be at.
    if (typeof at !== "number" || !Number.isFinite(at)) {
      hiddenBuckets += 1;
      continue;
    }
    const name = series.nameFor(row.bucket);
    if (name === null) {
      hiddenBuckets += 1;
      continue;
    }
    points.push({
      time: new Date(at),
      series: name,
      value: row.value,
      title: tipText(
        [formatTimestamp(at), ...(series.named ? [name] : [])].join(" · "),
        column,
        row,
        format,
      ),
    });
  }
  if (points.length === 0) return null;

  return {
    kind: "series",
    title: `${column.name} over time`,
    yLabel: column.name,
    points,
    series: series.list,
    format,
    note: {
      dropped: keyed.dropped,
      hiddenBuckets,
      hiddenSeries: series.hidden,
      shown: points.length,
    },
  };
}

/** An ordinary field key: bars in the theme's single hue when identity is on the
 *  axis, stacked categorical segments when a second key splits an additive total. */
function barViz(
  buckets: readonly GgBucket[],
  column: GgAggColumn,
  groupBy: readonly GgGroupKey[],
  format: (value: number) => string,
): GgViz | null {
  const keyed = drawable(buckets, column);
  if (keyed.rows.length === 0) return null;
  const by = groupLabel(groupBy);

  // Two keys stack only when the parts sum to the whole. Stacking an average draws a
  // total that measures nothing, so a non-additive aggregation flattens the
  // composite key onto the axis instead and claims nothing about the parts.
  const additive = column.func === "count" || column.func === "sum";
  if (groupBy.length >= 2 && additive) {
    const series = seriesRoster(keyed.rows, groupBy);
    const groups: string[] = [];
    const segments: StackedBarSegment[] = [];
    let hiddenSegments = 0;
    for (const row of keyed.rows) {
      const name = series.nameFor(row.bucket);
      if (name === null) {
        hiddenSegments += 1;
        continue;
      }
      const group = partLabel(row.bucket, groupBy, 0);
      if (!groups.includes(group)) {
        if (groups.length >= MAX_BARS) {
          hiddenSegments += 1;
          continue;
        }
        groups.push(group);
      }
      segments.push({
        group,
        series: name,
        value: row.value,
        title: tipText(`${group} · ${name}`, column, row, format),
      });
    }
    if (segments.length === 0) return null;
    return {
      kind: "stacked",
      title: `${column.name} by ${by}`,
      yLabel: column.name,
      segments,
      series: series.list,
      format,
      note: {
        dropped: keyed.dropped,
        hiddenBuckets: hiddenSegments,
        hiddenSeries: series.hidden,
        shown: segments.length,
      },
    };
  }

  const kept = keyed.rows.slice(0, MAX_BARS);
  return {
    kind: "bars",
    title: `${column.name} by ${by}`,
    yLabel: column.name,
    // No `color`: `barChart` falls back to the theme accent, so every bar wears one
    // hue and identity stays where it belongs, on the axis.
    points: kept.map((row) => {
      const label = bucketLabel(row.bucket, groupBy);
      return {
        label,
        value: row.value,
        title: tipText(label, column, row, format),
      } satisfies BarPoint;
    }),
    format,
    note: {
      dropped: keyed.dropped,
      hiddenBuckets: keyed.rows.length - kept.length,
      hiddenSeries: 0,
      shown: kept.length,
    },
  };
}

/** A `dist()` column: one box per bucket. No confidence interval — TCQ carries
 *  none, which is why {@link DistributionGroup}'s bounds are optional. */
function distributionViz(
  buckets: readonly GgBucket[],
  column: GgAggColumn,
  groupBy: readonly GgGroupKey[],
  format: (value: number) => string,
): GgViz | null {
  const rows: { bucket: GgBucket; dist: GgDistribution }[] = [];
  let dropped = 0;
  for (const bucket of buckets) {
    const dist = valueOf(bucket, column)?.distribution;
    if (!dist) {
      dropped += 1;
      continue;
    }
    rows.push({ bucket, dist });
  }
  if (rows.length === 0) return null;

  const kept = rows.slice(0, MAX_BOXES);
  return {
    kind: "distribution",
    title: groupBy.length
      ? `${column.name} by ${groupLabel(groupBy)}`
      : column.name,
    yLabel: column.name,
    groups: kept.map(({ bucket, dist }) => ({
      // No `color`: identity is on the axis, so a single hue is the honest encoding
      // and a categorical one would imply a relationship between the boxes.
      label: bucketLabel(bucket, groupBy) || "all runs",
      n: dist.n,
      // TCQ reports a summary, not the observations behind it. An empty list is the
      // supported "summary only" shape — the box, whiskers, median and `n` still
      // draw, and nothing is invented to fill the scatter.
      points: [],
      median: dist.median,
      mean: dist.mean,
      min: dist.min,
      max: dist.max,
      q1: dist.q1,
      q3: dist.q3,
    })),
    format,
    note: {
      dropped,
      hiddenBuckets: rows.length - kept.length,
      hiddenSeries: 0,
      shown: kept.length,
    },
  };
}

// --- Shared derivations --------------------------------------------------------

/** A bucket paired with the scalar it contributed to one column. */
interface DrawableRow {
  bucket: GgBucket;
  value: number;
  agg: GgAggValue;
}

/** The buckets that carry a scalar for this column, and how many did not.
 *  **The absent ones are dropped, not zeroed** — the single rule that keeps a chart
 *  from inventing a measurement the corpus never made. */
function drawable(
  buckets: readonly GgBucket[],
  column: GgAggColumn,
): { rows: DrawableRow[]; dropped: number } {
  const rows: DrawableRow[] = [];
  let dropped = 0;
  for (const bucket of buckets) {
    const agg = valueOf(bucket, column);
    if (agg?.value === undefined || !Number.isFinite(agg.value)) {
      dropped += 1;
      continue;
    }
    rows.push({ bucket, value: agg.value, agg });
  }
  return { rows, dropped };
}

/**
 * The series roster for a chart split by a second group key: which values get a
 * color, in a fixed order, and how many were left out.
 *
 * Ranked by total magnitude so the series that survive the cap are the ones the
 * chart is mostly about, with ties broken by code point so one result always
 * produces one roster. Past {@link MAX_SERIES} a value gets **no** color rather
 * than a recycled one — `nameFor` returns `null` and the caller counts it.
 */
function seriesRoster(
  rows: readonly DrawableRow[],
  groupBy: readonly GgGroupKey[],
): {
  list: StackedSeries[];
  named: boolean;
  hidden: number;
  nameFor: (bucket: GgBucket) => string | null;
} {
  if (groupBy.length < 2) {
    // One line, and its name is the chart's title; `timeSeriesChart` draws no legend
    // for a single series precisely so it is not repeated as a box.
    const list = [{ name: "", color: categoricalColor(0) }];
    return { list, named: false, hidden: 0, nameFor: () => "" };
  }

  const totals = new Map<string, number>();
  for (const row of rows) {
    const name = partLabel(row.bucket, groupBy, 1);
    totals.set(name, (totals.get(name) ?? 0) + Math.abs(row.value));
  }
  const ranked = [...totals.entries()]
    .sort((a, b) => b[1] - a[1] || compareCodePoints(a[0], b[0]))
    .map(([name]) => name);
  const kept = ranked.slice(0, MAX_SERIES);
  const keptSet = new Set(kept);

  return {
    list: kept.map((name, i) => ({ name, color: categoricalColor(i) })),
    named: true,
    hidden: ranked.length - kept.length,
    nameFor: (bucket) => {
      const name = partLabel(bucket, groupBy, 1);
      return keptSet.has(name) ? name : null;
    },
  };
}

/** The whole composite key as one axis label. */
function bucketLabel(bucket: GgBucket, groupBy: readonly GgGroupKey[]): string {
  return bucket.key
    .map((part, index) =>
      formatBucketKey(part.field, part.value, isHistogram(groupBy, index)),
    )
    .join(" · ");
}

/** One component of a composite key, for the axis or the series it drives. */
function partLabel(
  bucket: GgBucket,
  groupBy: readonly GgGroupKey[],
  index: number,
): string {
  const part = bucket.key[index];
  if (!part) return ABSENT;
  return formatBucketKey(part.field, part.value, isHistogram(groupBy, index));
}

/** The fields a chart groups by, for its title. */
function groupLabel(groupBy: readonly GgGroupKey[]): string {
  const fields = groupBy.slice(0, 2).map((key) => key.field);
  return fields.length ? fields.join(" · ") : "all runs";
}

/** A mark's tooltip: what it is, what it measures, and — when it matters — how many
 *  of the bucket's documents actually carried the field. */
function tipText(
  label: string,
  column: GgAggColumn,
  row: DrawableRow,
  format: (value: number) => string,
): string {
  const denominator =
    row.agg.contributing < row.bucket.n
      ? `\n${row.agg.contributing} of ${row.bucket.n} runs`
      : `\n${row.bucket.n} ${row.bucket.n === 1 ? "run" : "runs"}`;
  return `${label}\n${column.name}: ${format(row.value)}${denominator}`;
}

/** This column's entry in a bucket. */
function valueOf(
  bucket: GgBucket,
  column: GgAggColumn,
): GgAggValue | undefined {
  return bucket.values.find((entry) => entry.name === column.name);
}

/** Whether the group key at this position is a date histogram — the one thing that
 *  tells a bucket start from an ordinary number once both are just numbers. */
function isHistogram(groupBy: readonly GgGroupKey[], index: number): boolean {
  return groupBy[index]?.kind === "bucket";
}
