import { useMemo, useState } from "react";
import type { RunRecord } from "@test-cabinet/run-record";
import { Chart } from "./Chart";
import { Panel } from "./Panel";
import { barChart, boxAndWhisker } from "./plot/charts";
import type { BarPoint, BoxPoint } from "./plot/charts";
import type { ChartPalette } from "./plot/theme";
import styles from "./MetricChartWidget.module.scss";

// The two ways a widget can render its metric: a box-and-whisker spread across
// each model, or one labeled bar per run.
type ChartKind = "box" | "bars";

const KINDS: { key: ChartKind; label: string }[] = [
  { key: "box", label: "Box" },
  { key: "bars", label: "Bars" },
];

// Tilt the model labels so a large roster fits along the axis without overlap.
const LABEL_ROTATE = -40;

interface MetricChartWidgetProps {
  /** Heading naming the metric, e.g. "Total tokens". */
  title: string;
  /** The runs to chart, already scoped to one case + variant and sorted. */
  runs: RunRecord[];
  /** Pulls the charted value out of a run (token total, cost, …). */
  value: (run: RunRecord) => number;
  /** Unit shown on the y axis, e.g. "tokens" or "USD". */
  unit: string;
  /** d3 tick format for the y axis; pass a compact format for large counts. */
  yTickFormat?: string;
}

// A self-contained metric chart: a titled, full-width panel that charts one
// metric grouped by model, with a switch between the box-and-whisker spread and
// the per-run bars. The title carries the unit prominently (the axis label
// alone is easy to miss). Like every chart here it shows spread, never a ranking
// (docs/site.md).
export function MetricChartWidget({
  title,
  runs,
  value,
  unit,
  yTickFormat,
}: MetricChartWidgetProps) {
  const [kind, setKind] = useState<ChartKind>("box");

  const boxPoints = useMemo<BoxPoint[]>(
    () => runs.map((run) => ({ group: run.subject.modelId, value: value(run) })),
    [runs, value],
  );
  const barPoints = useMemo<BarPoint[]>(() => runBars(runs, value), [runs, value]);

  // Memoized so <Chart> only re-plots when the data, unit, or chart kind change.
  const spec = useMemo(() => {
    const labels = { y: unit, yTickFormat, xTickRotate: LABEL_ROTATE };
    return kind === "box"
      ? (palette: ChartPalette) => boxAndWhisker(boxPoints, palette, labels)
      : (palette: ChartPalette) => barChart(barPoints, palette, labels);
  }, [kind, boxPoints, barPoints, unit, yTickFormat]);

  return (
    <Panel>
      <header className={styles.header}>
        <h3 className={styles.title}>{title}</h3>
        <div
          className={styles.switcher}
          role="group"
          aria-label={`${title} chart type`}
        >
          {KINDS.map((entry) => (
            <button
              key={entry.key}
              type="button"
              className={
                entry.key === kind
                  ? `${styles.switch} ${styles.switchActive}`
                  : styles.switch
              }
              aria-pressed={entry.key === kind}
              onClick={() => setKind(entry.key)}
            >
              {entry.label}
            </button>
          ))}
        </div>
      </header>
      <Chart
        title={`${title} by model — ${kind === "box" ? "spread" : "per run"}`}
        spec={spec}
      />
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
