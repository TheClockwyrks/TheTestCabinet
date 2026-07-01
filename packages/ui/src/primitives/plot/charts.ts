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
// clipping it, given the rotation in degrees. Sized to the data so a long model
// id (or a `model · harness` label) keeps its full text on the axis.
function rotatedBottomMargin(
  data: readonly BarPoint[],
  rotateDeg: number,
): number {
  const maxChars = data.reduce((n, d) => Math.max(n, d.label.length), 0);
  const height = maxChars * GLYPH_PX * Math.sin((Math.abs(rotateDeg) * Math.PI) / 180);
  return Math.min(
    MAX_ROTATED_MARGIN,
    Math.max(MIN_ROTATED_MARGIN, Math.ceil(height + AXIS_PAD)),
  );
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
  return {
    ...basePlotOptions(palette),
    ...(labels.xTickRotate
      ? { marginBottom: rotatedBottomMargin(data, labels.xTickRotate) }
      : {}),
    x: { label: labels.x ?? null, type: "band", tickRotate: labels.xTickRotate },
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
      }),
      Plot.ruleY([0], { stroke: palette.border }),
    ],
  };
}
