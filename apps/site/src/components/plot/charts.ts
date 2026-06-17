import * as Plot from "@observablehq/plot";
import type { PlotOptions } from "@observablehq/plot";
import { basePlotOptions, type ChartPalette } from "./theme";

// Spec builders that turn the site's data into themed Plot option objects. They
// return PlotOptions (not DOM) so <Chart> stays the single place that renders
// into the document. Each builder layers the neon-themed `basePlotOptions` with
// marks colored from the live palette.

/** One bar in a bar chart. */
export interface BarPoint {
  /** The category label drawn along x. */
  label: string;
  /** The bar height. */
  value: number;
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

// Bottom margin that fits tilted category labels (long model ids) without
// clipping. Applied only when the x labels are rotated.
const ROTATED_LABEL_MARGIN = 100;

// A simple vertical bar chart, bars colored with the accent glow. Use for direct
// per-item magnitudes (e.g. a single run's token breakdown), not for comparing
// runs into a ranking.
export function barChart(
  data: readonly BarPoint[],
  palette: ChartPalette,
  labels: AxisLabels = {},
): PlotOptions {
  return {
    ...basePlotOptions(palette),
    ...(labels.xTickRotate ? { marginBottom: ROTATED_LABEL_MARGIN } : {}),
    x: { label: labels.x ?? null, type: "band", tickRotate: labels.xTickRotate },
    y: { label: labels.y ?? null, grid: true, tickFormat: labels.yTickFormat },
    marks: [
      Plot.barY(data as BarPoint[], {
        x: "label",
        y: "value",
        fill: palette.accent,
        rx: 2,
      }),
      Plot.ruleY([0], { stroke: palette.border }),
    ],
  };
}
