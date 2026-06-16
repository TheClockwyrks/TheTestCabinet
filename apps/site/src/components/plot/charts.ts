import * as Plot from "@observablehq/plot";
import type { PlotOptions } from "@observablehq/plot";
import { basePlotOptions, type ChartPalette } from "./theme";

// Spec builders that turn the site's data into themed Plot option objects. They
// return PlotOptions (not DOM) so <Chart> stays the single place that renders
// into the document. Each builder layers the neon-themed `basePlotOptions` with
// marks colored from the live palette.

/** One observation in a box-and-whisker distribution: a labeled group + value. */
export interface BoxPoint {
  /** The category the value belongs to (drawn along x), e.g. a harness slug. */
  group: string;
  /** The numeric value whose distribution is summarized, e.g. a run's cost. */
  value: number;
}

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
}

// A vertical box-and-whisker plot: one box per `group` summarizing the spread of
// its `value`s, with the raw points overlaid. Use for distributions where a
// ranking would be inappropriate (token usage, cost) — it shows spread, not a
// single score, honoring the no-leaderboard constraint.
export function boxAndWhisker(
  data: readonly BoxPoint[],
  palette: ChartPalette,
  labels: AxisLabels = {},
): PlotOptions {
  return {
    ...basePlotOptions(palette),
    x: { label: labels.x ?? null, type: "band" },
    y: { label: labels.y ?? null, grid: true, tickFormat: labels.yTickFormat },
    marks: [
      Plot.boxY(data as BoxPoint[], {
        x: "group",
        y: "value",
        stroke: palette.accent,
        fill: palette.accent2,
        fillOpacity: 0.18,
      }),
    ],
  };
}

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
    x: { label: labels.x ?? null, type: "band" },
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
