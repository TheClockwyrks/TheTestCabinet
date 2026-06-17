import { useMemo } from "react";
import type { RunRecord } from "@test-cabinet/run-record";
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
  runs: RunRecord[];
  /** Pulls the charted value out of a run (token total, cost, …). */
  value: (run: RunRecord) => number;
  /** Unit shown on the y axis, e.g. "tokens" or "USD". */
  unit: string;
  /** d3 tick format for the y axis; pass a compact format for large counts. */
  yTickFormat?: string;
  /** How the bar chart aggregates runs. Defaults to one bar per run. */
  barMode?: BarMode;
}

// A self-contained metric chart: a titled, full-width panel that charts one
// metric grouped by model as one labeled bar per run. The title carries the unit
// prominently (the axis label alone is easy to miss). Like every chart here it
// shows per-run magnitudes, never a ranking (docs/site.md).
export function MetricChartWidget({
  title,
  runs,
  value,
  unit,
  yTickFormat,
  barMode = "perRun",
}: MetricChartWidgetProps) {
  const barPoints = useMemo<BarPoint[]>(
    () =>
      barMode === "meanByModel"
        ? meanBars(runs, value)
        : runBars(runs, value),
    [runs, value, barMode],
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
// with the harness slug when the same model ran the variant more than once.
function runBars(
  runs: RunRecord[],
  value: (run: RunRecord) => number,
): BarPoint[] {
  const counts = new Map<string, number>();
  for (const run of runs) {
    counts.set(run.subject.modelId, (counts.get(run.subject.modelId) ?? 0) + 1);
  }
  return runs.map((run) => ({
    label:
      (counts.get(run.subject.modelId) ?? 0) > 1
        ? `${run.subject.modelId} · ${run.subject.harnessSlug}`
        : run.subject.modelId,
    value: value(run),
  }));
}

// Builds one bar per model: the mean of `value` across that model's runs, i.e.
// the average per run. Models keep their first-seen order.
function meanBars(
  runs: RunRecord[],
  value: (run: RunRecord) => number,
): BarPoint[] {
  const totals = new Map<string, { sum: number; count: number }>();
  const order: string[] = [];
  for (const run of runs) {
    const model = run.subject.modelId;
    const entry = totals.get(model);
    if (entry) {
      entry.sum += value(run);
      entry.count += 1;
    } else {
      totals.set(model, { sum: value(run), count: 1 });
      order.push(model);
    }
  }
  return order.map((model) => {
    const { sum, count } = totals.get(model)!;
    return { label: model, value: sum / count };
  });
}
