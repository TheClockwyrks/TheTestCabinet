// The Metrics file: a grid of per-request, over-time graphs for one agent — the
// value-per-model-call companion to the Context file's window-composition graph.
// Each metric accrues one data point per request (one `prompt` telemetry event),
// plotted against the same turn axis the Context graph uses, so the two read
// against the same run. A request with no datum for a metric (throughput when the
// call carried no timing; reasoning share when the harness folds reasoning into
// output) is skipped for that request rather than drawn as a misleading zero.

import { useMemo } from "react";
import {
  Chart,
  metricLineChart,
  type ChartPalette,
  type MetricPoint,
} from "@test-cabinet/ui";
import type { PromptTurn } from "./useGgRunState";
import { formatCost, formatPercent } from "./GgOverviewWidgets";
import styles from "./GgPanels.module.scss";

const throughputFmt = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});

// One metric drawn on the grid: how to pull its per-request value (null to skip
// that request), its fixed color, and how to format a value for the axis ticks and
// the latest-value chip.
interface MetricDef {
  key: string;
  label: string;
  // A stable, theme-legible hue (mirroring the context palette's family), so a
  // metric reads as the same color across re-renders.
  color: string;
  // The metric's value for one request, or null when that request has no datum for
  // it — skipped rather than plotted as a misleading zero.
  value: (p: PromptTurn) => number | null;
  // The latest-value chip's formatting (a fraction for the percentage metrics).
  formatValue: (v: number) => string;
  // d3-format spec (or function) for the y-axis ticks.
  yTickFormat: string | ((v: number) => string);
  // A fixed y ceiling — the share metrics frame to 1 (100%) rather than to their
  // tallest observation. Omit to let the data size the scale.
  yMax?: number;
}

// The tokens a turn generated: everything the model produced during the call
// (output plus any separately-reported reasoning), the numerator of throughput.
function generatedTokens(p: PromptTurn): number {
  return (p.tokens.output ?? 0) + (p.tokens.reasoning ?? 0);
}

// The four per-request metrics, in grid order.
const METRICS: readonly MetricDef[] = [
  {
    key: "throughput",
    label: "Tokens / s",
    color: "#6ea8fe",
    value: (p) =>
      p.durationMs != null && p.durationMs > 0
        ? generatedTokens(p) / (p.durationMs / 1000)
        : null,
    formatValue: (v) => `${throughputFmt.format(v)} tok/s`,
    yTickFormat: "~s",
  },
  {
    key: "cost",
    label: "Cost / request",
    color: "#8ac926",
    // The comparable (normalized) figure where present, else the provider's actual —
    // the same preference the itemized Requests view uses.
    value: (p) => p.cost?.comparable ?? p.cost?.actual ?? null,
    formatValue: formatCost,
    yTickFormat: (v) => `$${v < 1 ? v.toFixed(3) : v.toFixed(2)}`,
  },
  {
    key: "cacheRead",
    label: "Cache read",
    color: "#ffca3a",
    // Cached input as a share of all input. Null only when neither input class was
    // reported at all — a request that reported input but cached none reads as 0%.
    value: (p) => {
      const { cachedInput, uncachedInput } = p.tokens;
      if (cachedInput == null && uncachedInput == null) return null;
      const total = (cachedInput ?? 0) + (uncachedInput ?? 0);
      return total > 0 ? (cachedInput ?? 0) / total : null;
    },
    formatValue: formatPercent,
    yTickFormat: ".0%",
    yMax: 1,
  },
  {
    key: "reasoning",
    label: "Reasoning",
    color: "#c77dff",
    // Reasoning tokens as a share of all generated output. Null (not zero) when the
    // harness folds reasoning into output — the share is unknown, so the request has
    // no datum rather than a misleading 0%.
    value: (p) => {
      const reasoning = p.tokens.reasoning;
      if (reasoning == null) return null;
      const total = (p.tokens.output ?? 0) + reasoning;
      return total > 0 ? reasoning / total : null;
    },
    formatValue: formatPercent,
    yTickFormat: ".0%",
    yMax: 1,
  },
];

export function RequestMetricsGraphs({ prompts }: { prompts: PromptTurn[] }) {
  if (prompts.length === 0) {
    return (
      <p className={styles.empty}>
        No requests yet — each metric gains a data point per model call.
      </p>
    );
  }
  return (
    <div className={styles.stack}>
      <p className={styles.caption}>
        Per-request metrics over the run — one data point per model call, on the
        same turn axis as the Context graph.
      </p>
      <div className={styles.metricsGrid}>
        {METRICS.map((metric) => (
          <MetricCard key={metric.key} metric={metric} prompts={prompts} />
        ))}
      </div>
    </div>
  );
}

// One metric's card: its name and latest value in the header, its line graph (or a
// per-card empty state when the run recorded none of this metric) beneath.
function MetricCard({
  metric,
  prompts,
}: {
  metric: MetricDef;
  prompts: PromptTurn[];
}) {
  // The metric's non-null observations on the turn axis. A request with no datum is
  // skipped, so a graph that plots N of M requests is honest about which had one.
  const points = useMemo<MetricPoint[]>(() => {
    const out: MetricPoint[] = [];
    for (const p of prompts) {
      const value = metric.value(p);
      if (value != null && Number.isFinite(value))
        out.push({ turn: p.turn, value });
    }
    return out;
  }, [metric, prompts]);

  const latest = points.length ? points[points.length - 1]!.value : null;

  const spec = useMemo(
    () => (palette: ChartPalette) =>
      metricLineChart(points, palette, {
        yTickFormat: metric.yTickFormat,
        yMax: metric.yMax,
        color: metric.color,
      }),
    [points, metric],
  );

  return (
    <section className={styles.metricCard}>
      <header className={styles.metricCardHead}>
        <span className={styles.metricCardLabel}>{metric.label}</span>
        {latest != null && (
          <span className={styles.metricCardLatest}>
            {metric.formatValue(latest)}
          </span>
        )}
      </header>
      {points.length ? (
        <Chart title={`${metric.label} per request over the run`} spec={spec} />
      ) : (
        <p className={styles.metricEmpty}>Not recorded for this run.</p>
      )}
    </section>
  );
}
