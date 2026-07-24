import * as Plot from "@observablehq/plot";
import type { PlotOptions } from "@observablehq/plot";
import { basePlotOptions, type ChartPalette } from "./theme";

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
export function barChart(
  data: readonly BarPoint[],
  palette: ChartPalette,
  labels: AxisLabels = {},
): PlotOptions {
  // Only wire up hover tooltips when a bar actually carries one, so a plain
  // chart stays free of an empty tip. A `title` channel plus `tip: true` makes
  // Plot render the bar's `title` text as-is in an interactive tooltip.
  const hasTips = data.some((d) => d.title != null);
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
      // The hover highlight: a wash over the pointer-selected bar, matching the
      // tip's column selection (renders nothing until the pointer is near).
      ...(hasTips
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
    x: { label: null, type: "band", tickRotate: labels.xTickRotate },
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
// swatch legend keyed to the same colors. An optional `reference` draws a dashed
// rule (e.g. the window limit) with a small label. Needs at least two x positions
// to draw an area; a single column reads as a thin line, so callers should fall
// back to a static breakdown until a second point arrives.
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
  return {
    ...basePlotOptions(palette),
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
      }),
      Plot.ruleY([0], { stroke: palette.border }),
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

/** One point in a model's price history: a per-Mtok price at an observed time,
 * tagged with which comparable series it belongs to. */
export interface PricePoint {
  /** The observation time (rendered on a UTC time axis). */
  date: Date;
  /** The per-million-token price at that time (already scaled by the caller). */
  value: number;
  /** The series this point belongs to — `"Input"` or `"Output"`. Drives its color
   * and its legend entry. */
  series: string;
}

// A model's price-over-time chart: the input and output per-Mtok series plotted
// against a UTC time axis as a line with a dot at each observation, so a history
// of one to three points still reads (the dots carry it where the line is a
// single segment or absent). Two series, so a legend is always shown; the input
// series takes the theme accent and the output series the second accent, never a
// provider color. y starts at 0 (`ruleY([0])`) so the magnitudes aren't
// exaggerated by a floating baseline. An all-null series is omitted by the caller
// (it never appears in `data` or `seriesOrder`), so the legend lists only the
// series actually drawn.
export function priceHistoryChart(
  data: readonly PricePoint[],
  palette: ChartPalette,
  // The series to draw, in legend order. Each name maps to its fixed color:
  // "Output" to the second accent, everything else (i.e. "Input") to the accent.
  seriesOrder: readonly string[],
): PlotOptions {
  return {
    ...basePlotOptions(palette),
    x: { label: null, type: "utc" },
    y: { label: null, grid: true, zero: true, tickFormat: "$~s" },
    color: {
      legend: true,
      domain: seriesOrder as string[],
      range: seriesOrder.map((name) =>
        name === "Output" ? palette.accent2 : palette.accent,
      ),
    },
    marks: [
      Plot.ruleY([0], { stroke: palette.border }),
      // The line carries a multi-point history; the dot makes a one- or two-point
      // history (where the line is a single segment or absent) still legible.
      Plot.line(data as PricePoint[], {
        x: "date",
        y: "value",
        stroke: "series",
        // Group into one line per series explicitly. Left implicit, Plot infers z
        // from `stroke` and warns "the implicit z channel has high cardinality"
        // whenever the series count exceeds half the point count — which a short
        // history (e.g. one observation: a single Input and Output point) always
        // trips. Naming z here is exactly the grouping we want and silences it.
        z: "series",
        strokeWidth: 2,
      }),
      Plot.dot(data as PricePoint[], {
        x: "date",
        y: "value",
        fill: "series",
        // A surface-colored ring so overlapping dots (two series at one time) stay
        // separable, matching the skill's overlap rule.
        stroke: palette.surface,
        strokeWidth: 1,
        r: 4,
      }),
    ],
  };
}
