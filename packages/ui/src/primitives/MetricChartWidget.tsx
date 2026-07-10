import { useMemo } from "react";
import type { RunSummary } from "@test-cabinet/run-record/snapshot";
import { canonicalModelId } from "../modelId";
import { Chart } from "./Chart";
import { Panel } from "./Panel";
import { barChart } from "./plot/charts";
import type { BarPoint } from "./plot/charts";
import type { ChartPalette } from "./plot/theme";
import styles from "./MetricChartWidget.module.scss";

// Tilt the model labels so a large roster fits along the axis without overlap.
const LABEL_ROTATE = -40;

/**
 * How the bar chart reduces runs to bars:
 * - `perRun`: one bar per run, labeled by model (the raw magnitudes).
 * - `meanByModel`: one bar per model, the mean of that model's runs.
 */
type BarMode = "perRun" | "meanByModel";

interface MetricChartWidgetProps {
  /** Heading naming the metric, e.g. "Average tokens". */
  title: string;
  /** The runs to chart, already scoped to one case + variant and sorted. */
  runs: RunSummary[];
  /**
   * Pulls the charted value out of a run (token total, cost, …). A run for which
   * the value is `null` — the metric could not be determined for that run's
   * harness — is excluded from the chart entirely rather than plotted as zero, so
   * an incomplete figure never distorts the comparison.
   */
  value: (run: RunSummary) => number | null;
  /** Unit shown on the y axis, e.g. "tokens" or "USD". */
  unit: string;
  /** d3 tick format for the y axis; pass a compact format for large counts. */
  yTickFormat?: string;
  /** How the bar chart aggregates runs. Defaults to one bar per run. */
  barMode?: BarMode;
  /**
   * Resolves a run's `modelId` to a bar color (e.g. its provider's brand color).
   * Return null/undefined for an unknown model and the bar keeps the theme
   * accent. Omit entirely to color every bar with the accent.
   */
  colorForModel?: (modelId: string) => string | null | undefined;
}

// A self-contained metric chart: a titled, full-width panel that charts one
// metric grouped by model as one labeled bar per run. The title carries the unit
// prominently (the axis label alone is easy to miss). Like every chart here it
// shows per-run magnitudes, never a ranking.
export function MetricChartWidget({
  title,
  runs,
  value,
  unit,
  yTickFormat,
  barMode = "perRun",
  colorForModel,
}: MetricChartWidgetProps) {
  const barPoints = useMemo<BarPoint[]>(
    () =>
      barMode === "meanByModel"
        ? meanBars(runs, value, colorForModel)
        : runBars(runs, value, colorForModel),
    [runs, value, barMode, colorForModel],
  );

  // Memoized so <Chart> only re-plots when the data or unit change.
  const spec = useMemo(() => {
    const labels = { y: unit, yTickFormat, xTickRotate: LABEL_ROTATE };
    return (palette: ChartPalette) => barChart(barPoints, palette, labels);
  }, [barPoints, unit, yTickFormat]);

  return (
    <Panel>
      <header className={styles.header}>
        <h3 className={styles.title}>{title}</h3>
      </header>
      <Chart title={`${title} by model — per run`} spec={spec} />
    </Panel>
  );
}

// Builds one labeled bar per run. Labels prefer the model id, disambiguating
// with the harness slug when the same model ran the variant more than once. Model
// ids are canonicalized first, so an `openrouter/`-prefixed run and its bare
// equivalent count as the same model. Runs whose value is unknown (`null`) are
// dropped so they don't appear as zero bars.
function runBars(
  runs: RunSummary[],
  value: (run: RunSummary) => number | null,
  colorForModel?: (modelId: string) => string | null | undefined,
): BarPoint[] {
  const counts = new Map<string, number>();
  for (const run of runs) {
    const modelId = canonicalModelId(run.subject.modelId);
    counts.set(modelId, (counts.get(modelId) ?? 0) + 1);
  }
  return runs.flatMap((run) => {
    const v = value(run);
    if (v === null) return [];
    const modelId = canonicalModelId(run.subject.modelId);
    return [
      {
        label:
          (counts.get(modelId) ?? 0) > 1
            ? `${modelId} · ${run.subject.harnessSlug}`
            : modelId,
        value: v,
        color: colorForModel?.(modelId) ?? undefined,
      },
    ];
  });
}

// Builds one bar per model: the mean of `value` across that model's runs, i.e.
// the average per run. Model ids are canonicalized first, so an
// `openrouter/`-prefixed run and its bare equivalent aggregate into one bar.
// Models keep their first-seen order. Runs whose value is unknown (`null`) are
// excluded from the mean; a model with no known values gets no bar at all rather
// than a misleading zero.
function meanBars(
  runs: RunSummary[],
  value: (run: RunSummary) => number | null,
  colorForModel?: (modelId: string) => string | null | undefined,
): BarPoint[] {
  const totals = new Map<string, { sum: number; count: number }>();
  const order: string[] = [];
  for (const run of runs) {
    const v = value(run);
    if (v === null) continue;
    const model = canonicalModelId(run.subject.modelId);
    const entry = totals.get(model);
    if (entry) {
      entry.sum += v;
      entry.count += 1;
    } else {
      totals.set(model, { sum: v, count: 1 });
      order.push(model);
    }
  }
  return order.map((model) => {
    const { sum, count } = totals.get(model)!;
    return {
      label: model,
      value: sum / count,
      color: colorForModel?.(model) ?? undefined,
    };
  });
}
