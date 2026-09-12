import * as Plot from "@observablehq/plot";
import type { PlotOptions } from "@observablehq/plot";
import { basePlotOptions, type ChartPalette } from "./theme";
import type { DistributionStats } from "./distribution";

// Spec builders that turn data into themed Plot option objects. They return
// PlotOptions (not DOM) so <Chart> stays the single place that renders into the
// document. Each builder layers the themed `basePlotOptions` with marks colored
// from the live palette.

/** One bar in a bar chart. */
export interface BarPoint {
  /** The category label drawn along x. */
  label: string;
  /** The bar height. */
  value: number;
  /**
   * CSS color for this bar (e.g. a provider brand color). Omit to fall back to
   * the theme accent, so an uncolored chart still renders uniformly.
   */
  color?: string;
  /**
   * Text shown in an interactive tooltip when the bar is hovered — typically the
   * detail the aggregated bar height hides (e.g. the max/min behind a mean).
   * Newlines break the tip into lines. Omit to leave the bar without a tooltip;
   * a chart shows tooltips only when at least one of its bars carries one.
   */
  title?: string;
  /**
   * The spread behind an **aggregated** bar — the runs a mean bar averages. Set
   * it and the chart gains a hover affordance the plain bar cannot have: the
   * hovered bar is swapped for the box-and-whiskers of the distribution it is
   * summarizing, so the reader sees the spread the single height hides without
   * leaving the chart (see {@link barChart}).
   *
   * It must be set on **every** bar or on none. Plot's pointer transform selects
   * the nearest datum *in its own mark's data*, so a swap layer fed only the bars
   * that happen to carry a distribution would answer a hover over a bar that does
   * not by lighting up a different column. `barChart` therefore draws the swap
   * only when the whole chart is distributional, and a mixed chart keeps the plain
   * hover wash.
   */
  distribution?: BarDistribution;
}

/**
 * The runs behind one aggregated bar: their summary statistics, and the
 * individual observations so a caller can plot them (see {@link scatterChart}).
 * A single-run group is a legitimate value of this — `n` is 1 and every
 * statistic is that one run's value, which is the distribution collapsing to a
 * point rather than a spread of zero width being asserted.
 */
export interface BarDistribution extends DistributionStats {
  /** Every observation the statistics summarize, in the order the runs were folded. */
  points: readonly DistributionPoint[];
}

interface AxisLabels {
  x?: string;
  y?: string;
  /**
   * d3-format specifier (or function) for the y-axis ticks. Pass a compact
   * format like `"~s"` for large counts so labels stay short ("1M", "100k")
   * and don't get clipped by the chart's left margin.
   */
  yTickFormat?: string | ((value: number) => string);
  /**
   * Degrees to rotate the x-axis tick labels (e.g. `-40`). Use it to fit many
   * long category labels (model ids) along the axis without overlap; the chart
   * widens its bottom margin to make room for the tilted text.
   */
  xTickRotate?: number;
  /**
   * The bar order along x, as the full list of category labels. Pass it whenever
   * the bars carry a meaningful order — Plot otherwise sorts the ordinal domain
   * it infers, which silently overrides a caller's chosen ranking. Omit for
   * genuinely unordered categories.
   */
  xDomain?: readonly string[];
}

// Geometry for sizing the bottom margin under rotated x labels. A monospace
// glyph advances ~7.2px at the chart's 12px font, and a label tilted θ° occupies
// `width · sin θ` of vertical space; AXIS_PAD covers the tick gap and a little
// slack. We clamp so the common case gets comfortable room while a stray very
// long label can't blow the chart's height out.
const GLYPH_PX = 7.2;
const AXIS_PAD = 34;
const MIN_ROTATED_MARGIN = 96;
const MAX_ROTATED_MARGIN = 220;

// The bottom margin needed to fit the longest tilted category label without
// clipping it, given the rotation in degrees. Sized to the longest label so a
// long model id (or a `model · harness` label) keeps its full text on the axis.
function rotatedBottomMargin(
  labels: readonly string[],
  rotateDeg: number,
): number {
  const maxChars = labels.reduce((n, label) => Math.max(n, label.length), 0);
  const height =
    maxChars * GLYPH_PX * Math.sin((Math.abs(rotateDeg) * Math.PI) / 180);
  return Math.min(
    MAX_ROTATED_MARGIN,
    Math.max(MIN_ROTATED_MARGIN, Math.ceil(height + AXIS_PAD)),
  );
}

// Both the tooltip and the hover highlight select the bar under the pointer by
// column (`pointer: "x"` / `pointerX`), rather than Plot's 2D default that only
// fires within ~40px of the bar's top-center. This wide radius means the whole
// width — and full height — of a bar responds: the selection snaps to the
// nearest column wherever the pointer is over it, and both affordances read from
// the same selection so they always agree.
const POINTER_RADIUS = 1000;

// Hover-tooltip box options shared by the bar charts. Plot's tip defaults to a
// white box (`var(--plot-background)`), but our chart text is `currentColor` —
// the light themed `palette.text` — so a default box renders light-on-white and
// unreadable. Filling it with the dark surface lets the light text read; the
// text color is left as the ambient `currentColor`. See `POINTER_RADIUS` for the
// column-pointer behavior.
function tipBox(palette: ChartPalette): {
  pointer: "x";
  maxRadius: number;
  fill: string;
  stroke: string;
} {
  return {
    pointer: "x",
    maxRadius: POINTER_RADIUS,
    fill: palette.surface,
    stroke: palette.border,
  };
}

// A translucent light wash drawn over the pointer-selected bar (or stacked
// segment), lightening it so the bar visibly reacts wherever the tooltip appears.
// Rendered via `pointerX` with the same radius as the tip, so it selects the same
// bar the tip is describing — including tracking the nearest segment by height
// within a stacked column.
function highlightWash(palette: ChartPalette): {
  fill: string;
  fillOpacity: number;
} {
  return { fill: palette.text, fillOpacity: 0.18 };
}

// A simple vertical bar chart. Each bar takes its own `color` when set (e.g. a
// provider brand color), otherwise the theme accent, so an uncolored chart still
// reads uniformly. Use for direct per-item magnitudes (e.g. a single run's token
// breakdown), not for comparing runs into a ranking.
//
// A chart whose bars are aggregates gains a second reading for free: give every
// bar its `distribution` and hovering one replaces it with the box-and-whiskers
// of the runs it averages, so the spread a single height hides is one gesture
// away without the resting chart becoming a box plot.
export function barChart(
  data: readonly BarPoint[],
  palette: ChartPalette,
  labels: AxisLabels = {},
): PlotOptions {
  // Only wire up hover tooltips when a bar actually carries one, so a plain
  // chart stays free of an empty tip. A `title` channel plus `tip: true` makes
  // Plot render the bar's `title` text as-is in an interactive tooltip.
  const hasTips = data.some((d) => d.title != null);
  // The hover swap is drawn only when every bar carries its distribution — see
  // `BarPoint.distribution` for why a partial layer would mis-select. Flattened
  // here so the statistics are plain channels Plot can read by name.
  const boxes: BarBox[] | null =
    data.length > 0 && data.every((d) => d.distribution != null)
      ? data.map((d) => ({
          label: d.label,
          value: d.value,
          color: d.color ?? palette.accent,
          ...d.distribution!,
        }))
      : null;
  return {
    ...basePlotOptions(palette),
    ...(labels.xTickRotate
      ? {
          marginBottom: rotatedBottomMargin(
            data.map((d) => d.label),
            labels.xTickRotate,
          ),
        }
      : {}),
    x: {
      label: labels.x ?? null,
      type: "band",
      tickRotate: labels.xTickRotate,
      ...(labels.xDomain ? { domain: labels.xDomain as string[] } : {}),
    },
    y: { label: labels.y ?? null, grid: true, tickFormat: labels.yTickFormat },
    // Bars carry literal CSS colors, so use an identity color scale (no legend,
    // no categorical remapping) rather than letting Plot invent a scheme.
    color: { type: "identity" },
    marks: [
      Plot.barY(data as BarPoint[], {
        x: "label",
        y: "value",
        fill: (d: BarPoint) => d.color ?? palette.accent,
        rx: 2,
        ...(hasTips
          ? { title: (d: BarPoint) => d.title, tip: tipBox(palette) }
          : {}),
      }),
      Plot.ruleY([0], { stroke: palette.border }),
      // The hover affordance. A distributional chart swaps the hovered bar for the
      // box-and-whiskers behind it; a plain one washes the bar lighter. The two are
      // exclusive: washing a bar that has just been covered would paint a bright
      // rectangle back over the box and undo the swap.
      ...(boxes
        ? boxSwapMarks(boxes, palette)
        : hasTips
          ? [
              Plot.barY(
                data as BarPoint[],
                Plot.pointerX({
                  x: "label",
                  y: "value",
                  rx: 2,
                  maxRadius: POINTER_RADIUS,
                  ...highlightWash(palette),
                }),
              ),
            ]
          : []),
    ],
  };
}

/** One bar's distribution, flattened so Plot reads each statistic as a channel. */
interface BarBox extends DistributionStats {
  label: string;
  /** The bar's height — the mean the box is drawn in place of. */
  value: number;
  /** Resolved (never undefined) so every layer of the swap shares one hue. */
  color: string;
  points: readonly DistributionPoint[];
}

// The layers that turn the pointer-selected bar into its box plot: a cover the
// exact size of the bar, then the whisker, box, median and mean drawn over it.
// Every layer is `pointerX`-selected on the SAME data with the same radius, so
// all of them — and the tip the bar mark raises — describe one column.
//
// The cover is filled with the plot's own surface rather than being an erase: an
// SVG has no way to un-draw an earlier mark, and the chart sits on the shared
// translucent panel, which is this color over the backdrop. The grid behind the
// bar's footprint goes with it, which is the price of the swap.
//
// The raw per-run points are NOT drawn here, and their absence is the design
// rather than an omission: `pointerX` resolves to exactly one datum, so a points
// layer could only ever show one run of the hovered group. Every point of every
// group is what `scatterChart` is for, one click away on the same widget.
function boxSwapMarks(boxes: readonly BarBox[], palette: ChartPalette) {
  const data = boxes as BarBox[];
  const pointer = { x: "label" as const, maxRadius: POINTER_RADIUS };
  const colorOf = (d: BarBox) => d.color;
  return [
    Plot.barY(
      data,
      Plot.pointerX({ ...pointer, y: "value", rx: 2, fill: palette.surface }),
    ),
    // Whisker: the full min-max range at the bar's x position.
    Plot.ruleX(
      data,
      Plot.pointerX({
        ...pointer,
        y1: "min",
        y2: "max",
        stroke: colorOf,
        strokeWidth: 1,
        strokeOpacity: 0.7,
      }),
    ),
    // Box: the interquartile range. At n = 1 this is a zero-height rule, which is
    // the distribution collapsing to a point — the honest drawing of one run.
    Plot.barY(
      data,
      Plot.pointerX({
        ...pointer,
        y1: "q1",
        y2: "q3",
        fill: colorOf,
        fillOpacity: 0.28,
        stroke: colorOf,
        strokeWidth: 1.5,
        rx: 2,
      }),
    ),
    // Median: the bold tick across the box — the typical run of a skewed metric.
    Plot.tickY(
      data,
      Plot.pointerX({
        ...pointer,
        y: "median",
        stroke: colorOf,
        strokeWidth: 2,
      }),
    ),
    // Mean: a dashed tick where the bar's top was, so the figure the bar was
    // drawing is still readable beside the median it usually sits above.
    Plot.tickY(
      data,
      Plot.pointerX({
        ...pointer,
        y: "mean",
        stroke: palette.text,
        strokeWidth: 1,
        strokeDasharray: "3,3",
      }),
    ),
  ];
}

/** One segment of a stacked bar: the magnitude one series contributes to one
 * group's stack (e.g. how many of a model's runs earned one rating tier). */
export interface StackedBarSegment {
  /** The category drawn along x — the stack this segment belongs to (e.g. a
   * model name). */
  group: string;
  /** The series within the stack (e.g. a rating tier). Drives the segment's
   * color and legend entry via the chart's `series` list. */
  series: string;
  /** The segment's magnitude, stacked along y within its group. */
  value: number;
  /** Text shown in an interactive tooltip when the segment is hovered (e.g. the
   * group's full per-series breakdown). Newlines break the tip into lines. */
  title?: string;
}

/** A named series in a stacked bar chart, paired with its fixed color. The list
 * order is both the legend order and the bottom-to-top stacking order. */
export interface StackedSeries {
  name: string;
  color: string;
}

interface StackedAxisLabels {
  y?: string;
  yTickFormat?: string | ((value: number) => string);
  xTickRotate?: number;
  /**
   * The bar order along x, as the full list of group names. Pass it whenever the
   * groups have a meaningful order that is not their sorted order — Plot sorts an
   * ordinal domain it infers, which puts `"100"` before `"70"` and silently
   * scrambles a numeric progression. Omit for genuinely unordered categories.
   */
  xDomain?: readonly string[];
  /**
   * Which groups get a labeled tick. Use it when there are more bars than the axis
   * has room to name (e.g. every fifth turn), so the labels stay legible instead of
   * overlapping into a smear. Omit to label every bar.
   */
  xTicks?: readonly string[];
}

// A stacked vertical bar chart: one bar per group, split into fixed, colored
// series segments (e.g. a model's runs broken down by rating tier). The `series`
// list fixes both the legend order and the bottom-to-top stacking order, and
// maps each series to its color via a categorical scale (so a legend is always
// drawn, unlike `barChart`'s identity colors). A segment shows its `title` in an
// interactive tooltip on hover.
export function stackedBarChart(
  data: readonly StackedBarSegment[],
  palette: ChartPalette,
  series: readonly StackedSeries[],
  labels: StackedAxisLabels = {},
): PlotOptions {
  // Fixes the stacking order (first series at the baseline) and the legend.
  const order = series.map((s) => s.name);
  const hasTips = data.some((d) => d.title != null);
  return {
    ...basePlotOptions(palette),
    ...(labels.xTickRotate
      ? {
          marginBottom: rotatedBottomMargin(
            data.map((d) => d.group),
            labels.xTickRotate,
          ),
        }
      : {}),
    x: {
      label: null,
      type: "band",
      tickRotate: labels.xTickRotate,
      ...(labels.xDomain ? { domain: labels.xDomain as string[] } : {}),
      ...(labels.xTicks ? { ticks: labels.xTicks as string[] } : {}),
    },
    y: { label: labels.y ?? null, grid: true, tickFormat: labels.yTickFormat },
    color: {
      legend: true,
      domain: order,
      range: series.map((s) => s.color),
    },
    marks: [
      Plot.barY(data as StackedBarSegment[], {
        x: "group",
        y: "value",
        fill: "series",
        // Explicit z/stack order so the tiers stack in `series` order regardless
        // of the row order in `data`.
        order,
        rx: 1,
        ...(hasTips
          ? { title: (d: StackedBarSegment) => d.title, tip: tipBox(palette) }
          : {}),
      }),
      Plot.ruleY([0], { stroke: palette.border }),
      // The hover highlight: a wash over the pointer-selected segment. `z` +
      // `order` reproduce the base stack so the wash lands on the right segment,
      // and `pointerX` selects the same one the tip anchors to (the nearest by
      // height within the hovered column). Renders nothing until hovered.
      ...(hasTips
        ? [
            Plot.barY(
              data as StackedBarSegment[],
              Plot.pointerX({
                x: "group",
                y: "value",
                z: "series",
                order,
                rx: 1,
                maxRadius: POINTER_RADIUS,
                ...highlightWash(palette),
              }),
            ),
          ]
        : []),
    ],
  };
}

/** One point in a stacked time series: the magnitude one series contributes at
 * one x position (e.g. how many tokens one context source holds at one turn). */
export interface StackedAreaPoint {
  /** The position along x — the ordered progression (e.g. the turn index). */
  x: number;
  /** The series this point belongs to; drives its color and its stack band via
   * the chart's `series` list. */
  series: string;
  /** The magnitude stacked along y at this x. */
  value: number;
  /**
   * Text shown in an interactive tooltip when this point is hovered — typically
   * the whole x position's breakdown, since a band's own height is the one thing
   * a stacked area already shows. Newlines break the tip into lines. Omit to
   * leave the chart without tooltips; a chart shows them only when at least one
   * of its points carries one.
   */
  title?: string;
}

/** A vertical marker drawn across a stacked area at one x position — e.g. a gg
 * compaction boundary, where the window is summarized and drops. */
export interface StackedAreaMarker {
  /** The x position the marker sits at (e.g. the post-compaction turn index). */
  x: number;
  /** A short label drawn at the top of the marker (e.g. `"compacted"`). */
  label: string;
}

interface StackedAreaLabels {
  x?: string;
  y?: string;
  /** d3-format specifier (or function) for the y-axis ticks — e.g. `"~s"` to keep
   * large token counts short ("1M", "100k"). */
  yTickFormat?: string | ((value: number) => string);
  /**
   * A horizontal reference line drawn across the plot (e.g. the context window
   * limit), with a label anchored at its left. Omit to draw no reference.
   */
  reference?: { value: number; label: string };
  /**
   * An explicit top of the y scale, so the plot can be framed to the data rather
   * than to a ceiling far above it (e.g. a context window the run uses a sliver
   * of). Marks are clipped to the frame when set, so a stack that runs past the
   * cap is cut off at it instead of overflowing the plot. Omit to let the data
   * (and any `reference`) size the scale.
   */
  yMax?: number;
  /**
   * Vertical markers drawn across the plot at chosen x positions (e.g. gg
   * compaction boundaries), each a dashed rule with a small top label, so the
   * sawtooth of the window filling then dropping is legible. Omit to draw none.
   */
  markers?: readonly StackedAreaMarker[];
}

// A stacked area chart over an ordered x axis: one filled band per series,
// stacked bottom-to-top in `series` order, so the composition of a total over
// time reads at a glance (e.g. how a context window fills by source across a
// run's turns). The `series` list fixes both the stacking order and each band's
// color, so a series keeps the same hue across every x. The built-in color legend
// is suppressed (`legend: false`) — callers pair the chart with their own
// swatch legend keyed to the same colors. A point's `title` (when any carries one)
// is shown in an interactive tooltip on hover, with a vertical rule marking the
// hovered x — a band's own height is what the chart already shows, so the text a
// caller puts there is usually the whole x position's breakdown. An optional
// `reference` draws a dashed rule (e.g. the window limit) with a small label. It
// needs at least two x positions to draw an area; a single column reads as a thin
// line, so callers should fall back to a static breakdown until a second point
// arrives.
export function stackedAreaChart(
  data: readonly StackedAreaPoint[],
  palette: ChartPalette,
  series: readonly StackedSeries[],
  labels: StackedAreaLabels = {},
): PlotOptions {
  // First series sits at the baseline; the list order is the stacking order.
  const order = series.map((s) => s.name);
  const ref = labels.reference;
  const markers = labels.markers ?? [];
  const yMax = labels.yMax;
  const hasTips = data.some((d) => d.title != null);
  return {
    ...basePlotOptions(palette),
    // A capped y scale only frames the plot; without clipping, a stack taller than
    // the cap would draw straight over the axis and the title.
    ...(yMax != null ? { clip: true } : {}),
    x: {
      label: labels.x ?? null,
      // Whole-number turn ticks; a fractional tick between turns is meaningless.
      tickFormat: (v: number) => (Number.isInteger(v) ? String(v) : ""),
    },
    y: {
      label: labels.y ?? null,
      grid: true,
      zero: true,
      tickFormat: labels.yTickFormat,
      ...(yMax != null ? { domain: [0, yMax] } : {}),
    },
    color: {
      legend: false,
      domain: order,
      range: series.map((s) => s.color),
    },
    marks: [
      Plot.areaY(data as StackedAreaPoint[], {
        x: "x",
        y: "value",
        fill: "series",
        // Explicit stack order so bands stack in `series` order regardless of the
        // row order in `data`, and a hairline stroke separates adjacent bands.
        order,
        stroke: palette.surface,
        strokeWidth: 0.5,
        curve: "linear",
        ...(hasTips
          ? { title: (d: StackedAreaPoint) => d.title, tip: tipBox(palette) }
          : {}),
      }),
      Plot.ruleY([0], { stroke: palette.border }),
      // The hover affordance: a vertical rule at the pointer-selected x, drawn over
      // the bands so which turn the tip is describing is unmistakable. Same pointer
      // and radius as the tip, so the two always agree (renders nothing until the
      // pointer is over the plot).
      ...(hasTips
        ? [
            Plot.ruleX(
              data as StackedAreaPoint[],
              Plot.pointerX({
                x: "x",
                stroke: palette.text,
                strokeOpacity: 0.45,
                maxRadius: POINTER_RADIUS,
              }),
            ),
          ]
        : []),
      // The window-limit reference: a dashed rule with a left-anchored caption, so
      // how close the stack is to the ceiling reads directly off the chart.
      ...(ref
        ? [
            Plot.ruleY([ref.value], {
              stroke: palette.text,
              strokeDasharray: "4 3",
              strokeOpacity: 0.55,
            }),
            Plot.text([ref.label], {
              frameAnchor: "left",
              y: ref.value,
              dx: 4,
              dy: -6,
              fill: palette.muted,
              fontSize: 10,
              textAnchor: "start",
            }),
          ]
        : []),
      // Vertical boundary markers (e.g. compaction boundaries): a dashed rule at
      // each x with a small top-anchored label, so where the window was summarized
      // and dropped reads directly off the sawtooth.
      ...(markers.length
        ? [
            Plot.ruleX(markers as StackedAreaMarker[], {
              x: "x",
              stroke: palette.accent2,
              strokeDasharray: "3 2",
              strokeOpacity: 0.7,
            }),
            Plot.text(markers as StackedAreaMarker[], {
              x: "x",
              text: "label",
              frameAnchor: "top",
              dy: 2,
              fill: palette.accent2,
              fontSize: 10,
              textAnchor: "middle",
            }),
          ]
        : []),
    ],
  };
}

/** One observation on a {@link timeSeriesChart}: one series' value at one bucket
 * start. */
export interface TimeSeriesPoint {
  /**
   * The instant this observation belongs to — for a date histogram, the bucket's
   * floored **start**, not its midpoint or its label.
   *
   * A `Date` and not a string, and that is the whole point of this type. A date
   * histogram's buckets arrive as epoch milliseconds; the tempting shortcut is to
   * format them once for the axis and plot the formatted string on a band scale.
   * That silently swaps a *chronological* axis for a *categorical* one, and a
   * categorical axis draws its points in input order — so buckets that arrive in
   * any order but time order (TCQ's default bucket order is count descending, and
   * only a date-histogram first key overrides it) render as a zigzag between
   * unrelated instants rather than as a time series. Keeping the instant an
   * instant makes the axis chronological by construction and makes the sort below
   * meaningful.
   */
  time: Date;
  /** The series this point belongs to; drives its color and legend entry via the
   * chart's `series` list. */
  series: string;
  /** The value at that instant. */
  value: number;
  /**
   * Text shown in an interactive tooltip when this observation is hovered — the
   * figures behind the plotted value (a denominator, the bucket's `n`), which the
   * point itself cannot show. Newlines break the tip into lines. Omit to leave the
   * chart without tooltips; a chart shows them only when at least one point
   * carries one.
   */
  title?: string;
}

/** Labels and framing for a {@link timeSeriesChart}. */
export interface TimeSeriesLabels {
  /** The y-axis label (e.g. the aggregation's column name). Omit for none. */
  y?: string;
  /** d3-format specifier (or function) for the y-axis ticks — e.g. `"~s"` for large
   * counts, `"$~f"` for money. */
  yTickFormat?: string | ((value: number) => string);
  /** An explicit top of the y scale, so a bounded metric frames to its natural
   * ceiling rather than to the tallest observation. Omit to let the data size it. */
  yMax?: number;
}

// Sorts a time series into chronological order without mutating the caller's array.
//
// `Plot.line` connects its points in **input order** (unlike `Plot.lineY`, which
// carries an implicit sort by x), so the order this returns is literally the order
// the polyline is drawn in. Sorting here rather than relying on a mark default keeps
// the guarantee in one readable place and keeps it testable off the returned spec.
// `Array.prototype.sort` is stable, so points sharing an instant (one per series)
// keep the order they were given.
function chronological(
  data: readonly TimeSeriesPoint[],
): readonly TimeSeriesPoint[] {
  return [...data].sort((a, b) => a.time.getTime() - b.time.getTime());
}

// A metric over a UTC time axis: one line per series with a dot at each observation,
// so a one- or two-bucket history still reads (the dots carry it where the line is a
// single segment or absent). This is the chart a **date histogram** gets — an
// ordered progression of instants, which is exactly what a line is for and exactly
// what a bar chart over formatted date strings is not.
//
// Two properties are load-bearing rather than stylistic:
//
// - **The axis is chronological** (`type: "utc"`) and the data is sorted into
//   chronological order before it is drawn, so a bucket list that arrives in any
//   other order (count descending, say) draws left-to-right in time rather than
//   zigzagging between unrelated instants.
// - **A legend appears only for two or more series.** One series is named by the
//   chart's own title, and a legend box repeating that name is noise; two or more
//   need identity carried somewhere other than the color itself.
//
// y starts at 0 (`ruleY([0])`) so magnitudes aren't exaggerated by a floating
// baseline. Callers drop absent values rather than passing zero for them — a bucket
// that carried no value is not a bucket that measured zero.
export function timeSeriesChart(
  data: readonly TimeSeriesPoint[],
  palette: ChartPalette,
  series: readonly StackedSeries[],
  labels: TimeSeriesLabels = {},
): PlotOptions {
  const ordered = chronological(data);
  const order = series.map((s) => s.name);
  const yMax = labels.yMax;
  const hasTips = ordered.some((d) => d.title != null);
  return {
    ...basePlotOptions(palette),
    x: { label: null, type: "utc" },
    y: {
      label: labels.y ?? null,
      grid: true,
      zero: true,
      tickFormat: labels.yTickFormat,
      ...(yMax != null ? { domain: [0, yMax] } : {}),
    },
    color: {
      // One series is already named by the chart's title; two or more need a key.
      legend: series.length > 1,
      domain: order,
      range: series.map((s) => s.color),
    },
    marks: [
      Plot.ruleY([0], { stroke: palette.border }),
      Plot.line(ordered as TimeSeriesPoint[], {
        x: "time",
        y: "value",
        stroke: "series",
        // Group into one line per series explicitly. Left implicit, Plot infers z
        // from `stroke` and warns about a high-cardinality implicit channel whenever
        // the series count exceeds half the point count — which a two-bucket history
        // across several series always trips.
        z: "series",
        strokeWidth: 2,
      }),
      Plot.dot(ordered as TimeSeriesPoint[], {
        x: "time",
        y: "value",
        fill: "series",
        // A surface-colored ring so two series crossing at one instant stay
        // separable, and so a lone dot reads against the plot fill.
        stroke: palette.surface,
        strokeWidth: 1,
        r: 3,
        ...(hasTips
          ? { title: (d: TimeSeriesPoint) => d.title, tip: tipBox(palette) }
          : {}),
      }),
      // The hover affordance: a crosshair at the pointer-selected instant, so which
      // bucket the tip describes is unmistakable in a dense series. Same pointer and
      // radius as the tip, so the two always agree.
      ...(hasTips
        ? [
            Plot.ruleX(
              ordered as TimeSeriesPoint[],
              Plot.pointerX({
                x: "time",
                stroke: palette.text,
                strokeOpacity: 0.45,
                maxRadius: POINTER_RADIUS,
              }),
            ),
          ]
        : []),
    ],
  };
}

/** One raw run behind a distribution box, so the chart can plot every observation
 * — never just its summary — the way small-`n` honesty requires. Omit the whole
 * list on a {@link DistributionGroup} when the caller only has the aggregated
 * summary (e.g. a comparison's cost/token `MetricSummary` carries no per-run
 * breakdown) — the box, whiskers, median, and CI still draw and `n` is still
 * labeled, just without the individual dots overlaid. */
export interface DistributionPoint {
  /** The run's id, when known, shown in the point's tooltip. */
  runId?: string;
  value: number;
  /**
   * The point's tooltip text, when the caller wants to say more about this one
   * observation than its value and run id — when it ran, which model produced
   * it, what the group it sits in averages. Newlines break the tip into lines.
   * Omit and the chart composes the default tip from the label, the value and
   * the run id.
   */
  title?: string;
  /**
   * Where this observation's run lives. Set it and the point is drawn inside a
   * link, so a reader who spots an outlier can open the run that produced it
   * (and middle-click it into a new tab) instead of hunting for it in a list.
   * Omit for a point with nowhere to go.
   */
  href?: string;
}

/**
 * One group's (an arm's) full distribution for a {@link distributionChart}: the
 * summary statistics a box plot draws, plus the raw points behind them when the
 * caller has them (see {@link DistributionPoint}). Mirrors `MetricSummary`
 * (`@clockwyrks/run-record/comparison`) field-for-field so a caller can spread
 * an arm's summary straight in.
 */
export interface DistributionGroup {
  /** The x-axis category — the arm's label. Never merges two arms into one. */
  label: string;
  /** This arm's identity color. Omit to fall back to the theme accent — every
   * group should otherwise carry its own, since color here stands for identity. */
  color?: string;
  /** The number of runs summarized (always shown on the axis; never implied). */
  n: number;
  /** Empty when only the aggregated summary is available. */
  points: readonly DistributionPoint[];
  median: number;
  mean: number;
  min: number;
  max: number;
  q1: number;
  q3: number;
  /**
   * Bootstrap confidence interval on the median, **when the caller has one**.
   *
   * Optional because not every producer of a distribution computes one, and the
   * honest rendering of "no interval" is *no mark*, never a zero-width one at the
   * median (which reads as a suspiciously precise estimate) and never a silent
   * fallback to the whiskers (which are the raw min/max and mean something else
   * entirely). A group missing either bound is drawn without the CI layer; the box,
   * whiskers, median, points, and `n` are unaffected.
   *
   * The producer this exists for is [TCQ](/gg/analysis/query-language/)'s `dist()`,
   * which deliberately carries no interval: reproducing a seeded bootstrap
   * bit-for-bit across the Rust evaluator and its browser twin would be the most
   * drift-prone construct in a mirrored engine, for a decoration on an exploratory
   * chart. The comparisons surface — where inferential claims are actually made —
   * keeps its interval and still passes both bounds.
   */
  ciLow?: number;
  ciHigh?: number;
}

interface DistributionLabels {
  y?: string;
  yTickFormat?: string | ((value: number) => string);
  /** Formats a raw value for a point's tooltip and the box's summary tooltip. */
  formatValue?: (value: number) => string;
}

// Pixel nudges that separate the three layers drawn at each arm's x position: the
// bootstrap CI sits to the left of the box, the raw points to the right, so all
// three are legible at once instead of stacking on the same vertical line.
const CI_DX = -14;
const POINTS_DX = 14;

// A per-arm distribution chart: for each group, a box (Q1–Q3) with whiskers
// (min–max) and a median tick, a bootstrap confidence interval on the median
// (thin, offset left), and every raw run plotted as its own point (offset right)
// — so the spread and the sample size are never implied. This is the chart the
// [statistics methodology](/comparisons/statistics/) asks for: "show the raw
// points, not just the summary." Groups keep the color they're given — an arm's
// identity — and are placed along a band x scale in the order given (never
// re-sorted, never merged), with the arm's label doing the identity work a
// legend would otherwise carry (there is one color per x category already).
export function distributionChart(
  groups: readonly DistributionGroup[],
  palette: ChartPalette,
  labels: DistributionLabels = {},
): PlotOptions {
  const order = groups.map((g) => g.label);
  const formatValue = labels.formatValue ?? String;
  const colorOf = (g: DistributionGroup) => g.color ?? palette.accent;

  const points = groups.flatMap((g) =>
    g.points.map((p) => ({ label: g.label, color: colorOf(g), ...p })),
  );

  // Only the groups that actually carry an interval get the CI layer, so a
  // distribution with no bootstrap behind it (TCQ's `dist()`) draws its box and
  // whiskers with nothing beside them rather than a fabricated tick at the median.
  const withCi = groups.filter(
    (g) => g.ciLow != null && g.ciHigh != null,
  ) as DistributionGroup[];

  return {
    ...basePlotOptions(palette),
    x: { label: null, type: "band", domain: order },
    y: {
      label: labels.y ?? null,
      grid: true,
      zero: true,
      tickFormat: labels.yTickFormat,
    },
    color: { type: "identity" },
    marks: [
      Plot.ruleY([0], { stroke: palette.border }),
      // Whisker: the full min–max range, a thin vertical rule at the arm's x
      // position (`ruleX`, not `ruleY` — the mark that spans a y-interval at a
      // fixed x, rather than a horizontal line).
      Plot.ruleX(groups as DistributionGroup[], {
        x: "label",
        y1: "min",
        y2: "max",
        stroke: colorOf,
        strokeWidth: 1,
        strokeOpacity: 0.7,
      }),
      // Box: the interquartile range, filled and outlined in the arm's color.
      Plot.barY(groups as DistributionGroup[], {
        x: "label",
        y1: "q1",
        y2: "q3",
        fill: colorOf,
        fillOpacity: 0.28,
        stroke: colorOf,
        strokeWidth: 1.5,
        rx: 2,
      }),
      // Median: a short, bold tick across the box.
      Plot.tickY(groups as DistributionGroup[], {
        x: "label",
        y: "median",
        stroke: colorOf,
        strokeWidth: 2,
      }),
      // Bootstrap CI on the median: a thin offset vertical rule with end ticks,
      // distinct from the whisker (which is the raw min/max, not a confidence
      // interval). Drawn only over the groups that have one — see `withCi`.
      ...(withCi.length
        ? [
            Plot.ruleX(withCi, {
              x: "label",
              y1: "ciLow",
              y2: "ciHigh",
              stroke: palette.muted,
              strokeWidth: 2,
              dx: CI_DX,
            }),
            Plot.tickY(withCi, {
              x: "label",
              y: "ciLow",
              stroke: palette.muted,
              strokeWidth: 1,
              dx: CI_DX,
            }),
            Plot.tickY(withCi, {
              x: "label",
              y: "ciHigh",
              stroke: palette.muted,
              strokeWidth: 1,
              dx: CI_DX,
            }),
          ]
        : []),
      // Every raw run as its own point — the data a box/median only summarizes,
      // shown plainly so a small `n` never hides behind an aggregate.
      Plot.dot(points, {
        x: "label",
        y: "value",
        fill: "color",
        stroke: palette.surface,
        strokeWidth: 1,
        r: 4,
        dx: POINTS_DX,
        title: (d: (typeof points)[number]) => pointTitle(d, formatValue),
        ...(points.some((p) => p.href != null)
          ? { href: (d: (typeof points)[number]) => d.href, target: "_self" }
          : {}),
        tip: tipBox(palette),
      }),
    ],
  };
}

// The tooltip one raw observation carries: whatever the caller wrote for it,
// otherwise its group, its value, and the run it came from. Shared by the two
// charts that draw individual runs so a point reads the same in either.
function pointTitle(
  point: DistributionPoint & { label: string },
  formatValue: (value: number) => string,
): string {
  if (point.title != null) return point.title;
  const head = `${point.label}\n${formatValue(point.value)}`;
  return point.runId ? `${head}\nrun ${point.runId}` : head;
}

/**
 * One group's runs for a {@link scatterChart}: every observation as its own dot,
 * and the average drawn through them.
 */
export interface ScatterGroup {
  /** The x-axis category — the group's label. Never merges two groups into one. */
  label: string;
  /** The group's identity color. Omit to fall back to the theme accent. */
  color?: string;
  /** The average drawn as a horizontal rule across the group's slot. */
  mean: number;
  /** Every run in the group. A group with one run draws one dot on its own rule. */
  points: readonly DistributionPoint[];
}

// How far apart two dots of one group sit, and how far the spread may reach —
// both in x-axis units, where 1 is the distance between two groups. The offset is
// there only so two runs of similar value don't hide each other; it carries no
// meaning, which is why the spread is tight and a lone run sits dead center.
const DOT_STEP = 0.09;
const DOT_SPREAD = 0.34;
// Half the width of a group's average rule, a little short of touching its
// neighbour's.
const MEAN_RULE_HALF = 0.42;

/** Labels and framing for a {@link scatterChart}. */
export interface ScatterLabels extends AxisLabels {
  /**
   * Formats a raw value for a point's tooltip. Only the fallback tip uses it — a
   * caller that writes each point's own `title` (naming the run, when it ran, what
   * its group averages) never reaches it.
   */
  formatValue?: (value: number) => string;
}

// Hover-tip options for a chart whose marks are individually meaningful points:
// same box as `tipBox`, but the pointer selects in BOTH dimensions, so the tip
// describes the dot the reader is actually pointing at rather than some run that
// merely shares its column. The radius is deliberately small for the same reason.
const POINT_POINTER_RADIUS = 24;

function tipBoxXY(palette: ChartPalette): {
  pointer: "xy";
  maxRadius: number;
  fill: string;
  stroke: string;
} {
  return {
    pointer: "xy",
    maxRadius: POINT_POINTER_RADIUS,
    fill: palette.surface,
    stroke: palette.border,
  };
}

/**
 * A per-group scatter: every run of every group as its own dot, with a
 * horizontal rule at that group's average.
 *
 * It is the companion to a mean bar chart rather than a replacement for one. A
 * bar answers "what does a run of this cost?"; this answers "and how much do the
 * runs differ?", which at the sample sizes a test case gathers is usually the
 * more useful question — three runs whose costs are 1, 1 and 7 have the same
 * mean as three that are all 3, and the bar cannot tell them apart.
 *
 * Two things are load-bearing:
 *
 * - **x is a group slot, not a quantity.** Groups sit at integer positions and a
 *   dot is nudged off center only so its neighbours stay visible. The axis is a
 *   linear scale (not the band a bar chart uses) purely because that is what lets
 *   one mark hold every dot at its own offset — and one mark is what keeps ONE
 *   tooltip on screen at a time. The tick positions are identical to the band's,
 *   so switching a widget between the two modes does not move the labels.
 * - **The order is the caller's**, as `xDomain`, for the same reason every other
 *   chart here pins it: Plot sorts a domain it infers, which would silently
 *   override a chosen order.
 *
 * y starts at 0 so magnitudes are not exaggerated by a floating baseline, and a
 * point whose value is unknown is dropped by the caller rather than passed as a
 * zero.
 */
export function scatterChart(
  groups: readonly ScatterGroup[],
  palette: ChartPalette,
  labels: ScatterLabels = {},
): PlotOptions {
  const order = [...(labels.xDomain ?? groups.map((g) => g.label))];
  const slotOf = new Map(order.map((label, index) => [label, index]));
  const format = labels.formatValue ?? String;

  const dots = groups.flatMap((group) => {
    const slot = slotOf.get(group.label);
    if (slot === undefined) return [];
    const color = group.color ?? palette.accent;
    const n = group.points.length;
    // Evenly spread across a width that grows with the run count and then stops,
    // so a pair of runs stays tight and a dozen stays inside its own slot.
    const half = Math.min(DOT_SPREAD, (DOT_STEP * (n - 1)) / 2);
    return group.points.map((point, index) => ({
      ...point,
      label: group.label,
      color,
      x: n > 1 ? slot + (index / (n - 1) - 0.5) * 2 * half : slot,
    }));
  });
  const hasLinks = dots.some((d) => d.href != null);

  return {
    ...basePlotOptions(palette),
    ...(labels.xTickRotate
      ? { marginBottom: rotatedBottomMargin(order, labels.xTickRotate) }
      : {}),
    x: {
      label: labels.x ?? null,
      type: "linear",
      // A half-slot of padding at each end, so the outermost group's dots and its
      // average rule are inside the frame rather than clipped by it.
      domain: [-0.5, Math.max(order.length - 0.5, 0.5)],
      ticks: order.map((_, index) => index),
      tickFormat: (value: number) => order[value] ?? "",
      tickRotate: labels.xTickRotate,
      // A vertical rule per group would only repeat what the tick already says.
      grid: false,
    },
    y: {
      label: labels.y ?? null,
      grid: true,
      zero: true,
      tickFormat: labels.yTickFormat,
    },
    // Dots carry literal CSS colors, so use an identity scale rather than letting
    // Plot invent a categorical scheme (and a legend the axis already provides).
    color: { type: "identity" },
    marks: [
      Plot.ruleY([0], { stroke: palette.border }),
      // The group's average, drawn through its dots — the same figure the bar mode
      // draws as a bar height, so flipping between the modes reads as one chart.
      Plot.ruleY(groups as ScatterGroup[], {
        y: "mean",
        x1: (d: ScatterGroup) => (slotOf.get(d.label) ?? 0) - MEAN_RULE_HALF,
        x2: (d: ScatterGroup) => (slotOf.get(d.label) ?? 0) + MEAN_RULE_HALF,
        stroke: (d: ScatterGroup) => d.color ?? palette.accent,
        strokeWidth: 2,
      }),
      // Every run, in one mark: see the note on x above for why that matters.
      Plot.dot(dots, {
        x: "x",
        y: "value",
        fill: "color",
        // A surface-colored ring so two runs of similar value stay separable.
        stroke: palette.surface,
        strokeWidth: 1,
        r: 4,
        title: (d: (typeof dots)[number]) => pointTitle(d, format),
        ...(hasLinks
          ? { href: (d: (typeof dots)[number]) => d.href, target: "_self" }
          : {}),
        tip: tipBoxXY(palette),
      }),
    ],
  };
}

/** One observation on a per-request metric line: a value at a turn index. */
export interface MetricPoint {
  /** The turn index (0-based) this observation belongs to — the x position, shared
   * with the context graph's turn axis so the two read against the same run. */
  turn: number;
  /** The metric's value at that turn. */
  value: number;
  /**
   * Text shown in an interactive tooltip when this observation's column is
   * hovered — typically the figures the single plotted value is computed from,
   * which the point itself cannot show. Newlines break the tip into lines. Omit
   * to leave the chart without tooltips; a chart shows them only when at least
   * one of its points carries one.
   */
  title?: string;
}

/** Labels and framing for a {@link metricLineChart}. */
export interface MetricLineLabels {
  /** The y-axis label (e.g. "tokens/s"). Omit for none. */
  y?: string;
  /** d3-format specifier (or function) for the y-axis ticks — e.g. `"~s"` for large
   * counts, `"$~f"` for money, `"~%"` for a fraction drawn as a percent. */
  yTickFormat?: string | ((value: number) => string);
  /** An explicit top of the y scale, so a bounded metric (e.g. a percentage) frames
   * to its natural ceiling rather than to the tallest observation. Omit to let the
   * data size the scale. */
  yMax?: number;
  /** The line/dot color. Omit to take the theme accent. */
  color?: string;
}

// A single-series metric-over-requests line chart: one value per turn plotted against
// the integer turn axis as a line with a dot at each observation, so a history of one
// or two points still reads (the dots carry it where the line is a single segment or
// absent). y starts at 0 (`ruleY([0])`) so magnitudes aren't exaggerated by a floating
// baseline. Use for a per-request metric that accrues one data point per model call
// (throughput, cost, cache-read share, reasoning share); pair several to read a run's
// request-level metrics side by side. A point's `title` (when any carries one) is
// shown in an interactive tooltip on hover, with a crosshair rule and a widened dot
// marking the observation it describes. Needs at least one point; a caller with none
// should fall back to an empty state rather than draw an axis with nothing on it.
export function metricLineChart(
  data: readonly MetricPoint[],
  palette: ChartPalette,
  labels: MetricLineLabels = {},
): PlotOptions {
  const color = labels.color ?? palette.accent;
  const yMax = labels.yMax;
  const hasTips = data.some((d) => d.title != null);
  return {
    ...basePlotOptions(palette),
    x: {
      label: null,
      // Whole-number turn ticks; a fractional tick between turns is meaningless.
      tickFormat: (v: number) => (Number.isInteger(v) ? String(v) : ""),
    },
    y: {
      label: labels.y ?? null,
      grid: true,
      zero: true,
      tickFormat: labels.yTickFormat,
      ...(yMax != null ? { domain: [0, yMax] } : {}),
    },
    marks: [
      Plot.ruleY([0], { stroke: palette.border }),
      Plot.line(data as MetricPoint[], {
        x: "turn",
        y: "value",
        stroke: color,
        strokeWidth: 2,
      }),
      Plot.dot(data as MetricPoint[], {
        x: "turn",
        y: "value",
        fill: color,
        // A surface-colored ring so a lone dot (a one-point history) stays legible
        // against the plot fill.
        stroke: palette.surface,
        strokeWidth: 1,
        r: 3,
        ...(hasTips
          ? { title: (d: MetricPoint) => d.title, tip: tipBox(palette) }
          : {}),
      }),
      // The hover affordance: a crosshair rule at the pointer-selected turn and a
      // widened dot on the observation itself, so the point the tip is describing is
      // picked out of a dense line. Both use the same pointer and radius as the tip,
      // so all three agree on which observation is selected (they render nothing
      // until the pointer is over the plot).
      ...(hasTips
        ? [
            Plot.ruleX(
              data as MetricPoint[],
              Plot.pointerX({
                x: "turn",
                stroke: palette.text,
                strokeOpacity: 0.45,
                maxRadius: POINTER_RADIUS,
              }),
            ),
            Plot.dot(
              data as MetricPoint[],
              Plot.pointerX({
                x: "turn",
                y: "value",
                fill: color,
                stroke: palette.text,
                strokeWidth: 1.5,
                r: 5,
                maxRadius: POINTER_RADIUS,
              }),
            ),
          ]
        : []),
    ],
  };
}

/** One bar in a {@link horizontalBarChart}: a named thing and the magnitude that ranks
 * it. */
export interface HorizontalBarPoint {
  /**
   * The category drawn down y, and the band scale's domain key — so it must be unique
   * within one chart. A caller ranking things whose names repeat (two functions called
   * `update`, in different files) has to qualify them itself; silently merging two bars
   * into one would misstate every value in the chart.
   */
  label: string;
  /** The bar's length. */
  value: number;
  /** Text shown in an interactive tooltip when the bar's row is hovered — the figures
   * the ranked value hides (where the thing lives, its other measures). Newlines break
   * the tip into lines. Omit to leave the bar without a tooltip; a chart shows tooltips
   * only when at least one of its bars carries one. */
  title?: string;
}

/** Labels and framing for a {@link horizontalBarChart}. */
export interface HorizontalBarLabels {
  /** The x-axis label (what the length means). Omit for none. */
  x?: string;
  /** d3-format specifier (or function) for the x-axis ticks. */
  xTickFormat?: string | ((value: number) => string);
  /** The bar color — one hue for the whole chart, because length is already carrying
   * the magnitude and a second channel for the same fact is noise. Omit to take the
   * theme accent. */
  color?: string;
  /**
   * Draws each bar's value at its tip, formatted by this function. Direct labels are
   * what let a ranking be read without hovering anything, and a horizontal bar is the
   * one form where they always fit (the row is as tall as the text and the space to the
   * right of the shortest bar is free). Omit to leave the axis to carry the values.
   */
  valueLabel?: (value: number) => string;
}

// Geometry for a horizontal bar chart. The height is a function of the row count rather
// than a fixed box: a ranking of five and a ranking of twenty want the same row height,
// and a fixed height would either squash the bars past the mark spec's 24px ceiling or
// strand a short ranking in a tall empty frame.
const ROW_PX = 22;
const H_BAR_MARGIN_TOP = 12;
// A category label's left margin, sized to the longest label so a qualified function
// name keeps its text instead of being clipped into ambiguity.
const MIN_LABEL_MARGIN = 90;
const MAX_LABEL_MARGIN = 260;

// Hover-tip options for a chart whose categories run down y: same box as `tipBox`, with
// the pointer selecting by ROW rather than by column, so the whole width of a row
// responds and the tip describes the bar the pointer is actually beside.
function tipBoxY(palette: ChartPalette): {
  pointer: "y";
  maxRadius: number;
  fill: string;
  stroke: string;
} {
  return {
    pointer: "y",
    maxRadius: POINTER_RADIUS,
    fill: palette.surface,
    stroke: palette.border,
  };
}

/**
 * A horizontal bar chart: one bar per named thing, ranked by length.
 *
 * This is the form for a ranking whose categories have **long names** — a function, a
 * file path, a module. Turned on its side the labels read horizontally at full length
 * instead of being tilted 40° and clipped by the bottom margin, and the eye runs down a
 * list, which is what a ranking is.
 *
 * Two things are load-bearing rather than stylistic:
 *
 * - **The order is the caller's**, pinned as the band domain. Plot sorts an ordinal
 *   domain it infers, which would silently alphabetize a chart whose whole point is that
 *   it is sorted by magnitude.
 * - **One hue.** Length already encodes the magnitude; painting each bar a different
 *   color would spend the categorical palette on identity that the axis labels already
 *   carry, and imply a series structure that is not there.
 */
export function horizontalBarChart(
  data: readonly HorizontalBarPoint[],
  palette: ChartPalette,
  labels: HorizontalBarLabels = {},
): PlotOptions {
  const color = labels.color ?? palette.accent;
  const hasTips = data.some((d) => d.title != null);
  const order = data.map((d) => d.label);
  const longest = order.reduce((n, label) => Math.max(n, label.length), 0);
  const marginLeft = Math.min(
    MAX_LABEL_MARGIN,
    Math.max(MIN_LABEL_MARGIN, Math.ceil(longest * GLYPH_PX) + 12),
  );
  const valueLabel = labels.valueLabel;
  // Room at the right for the direct labels, measured from the longest one actually
  // rendered — a label drawn outside the frame is a clipped label, which is the failure
  // the direct labels were added to avoid.
  const marginRight = valueLabel
    ? Math.ceil(
        data.reduce(
          (n, d) => Math.max(n, valueLabel(d.value).length * GLYPH_PX),
          0,
        ),
      ) + 12
    : undefined;
  return {
    ...basePlotOptions(palette),
    marginLeft,
    marginTop: H_BAR_MARGIN_TOP,
    ...(marginRight != null ? { marginRight } : {}),
    // The frame grows with the ranking, so every row gets the same height whatever the
    // row count, and the x-axis band below is always inside the figure.
    height: H_BAR_MARGIN_TOP + data.length * ROW_PX + 40,
    x: {
      label: labels.x ?? null,
      grid: true,
      zero: true,
      tickFormat: labels.xTickFormat,
    },
    y: { label: null, type: "band", domain: order, padding: 0.32 },
    marks: [
      Plot.barX(data as HorizontalBarPoint[], {
        x: "value",
        y: "label",
        fill: color,
        rx: 2,
        ...(hasTips
          ? { title: (d: HorizontalBarPoint) => d.title, tip: tipBoxY(palette) }
          : {}),
      }),
      Plot.ruleX([0], { stroke: palette.border }),
      // Direct labels at the tips, in text ink — never the bar's color, which is a
      // light accent and illegible as text on the surface.
      ...(valueLabel
        ? [
            Plot.text(data as HorizontalBarPoint[], {
              x: "value",
              y: "label",
              text: (d: HorizontalBarPoint) => valueLabel(d.value),
              textAnchor: "start",
              dx: 5,
              fill: palette.text,
            }),
          ]
        : []),
      // The hover highlight: a wash over the pointer-selected row, matching the tip's
      // row selection (renders nothing until the pointer is near).
      ...(hasTips
        ? [
            Plot.barX(
              data as HorizontalBarPoint[],
              Plot.pointerY({
                x: "value",
                y: "label",
                rx: 2,
                maxRadius: POINTER_RADIUS,
                ...highlightWash(palette),
              }),
            ),
          ]
        : []),
    ],
  };
}
