// The Metrics file: a stack of over-time graphs for one agent — the value-per-model-call
// companion to the Context file's window-composition graph. It opens with where each
// turn's wall-clock went (a stacked bar per turn, see `TurnTimingGraph`), then the
// per-request value metrics.
//
// Each metric accrues one data point per request (one `prompt` telemetry event),
// plotted against the same turn axis the Context graph uses, so the two read
// against the same run. A request with no datum for a metric (throughput when the
// call carried no timing; reasoning share when the harness folds reasoning into
// output) is skipped for that request rather than drawn as a misleading zero.
//
// Every plotted point carries a hover tooltip naming its turn and value, plus the
// figures that value was computed from — the tokens and the latency behind a
// throughput, the two cost figures behind a price, the numerator and denominator
// behind a share. A single point cannot show its own arithmetic, and without it a
// reader can see that a request was slow but not whether it was long or starved.

import { useMemo } from "react";
import {
  Chart,
  metricLineChart,
  type ChartPalette,
  type MetricPoint,
} from "@test-cabinet/ui";
import type { PromptTurn, TurnTiming } from "./useGgRunState";
import { formatCost, formatPercent } from "./GgOverviewWidgets";
import { formatThroughput } from "./ggThroughput";
import { formatMs, TurnTimingGraph } from "./TurnTimingGraph";
import styles from "./GgPanels.module.scss";

const tokenFmt = new Intl.NumberFormat("en-US");

// A token count for a tooltip line, always spelled out — a tooltip is where a
// reader goes for the exact figure, so this is the one place not to abbreviate.
function tokens(n: number): string {
  return `${tokenFmt.format(n)} token${n === 1 ? "" : "s"}`;
}

// One metric drawn on the grid: how to pull its per-request value (null to skip
// that request), its fixed color, and how to format a value for the axis ticks and
// the header chip.
export interface MetricDef {
  key: string;
  label: string;
  // A stable, theme-legible hue (mirroring the context palette's family), so a
  // metric reads as the same color across re-renders.
  color: string;
  // The metric's value for one request, or null when that request has no datum for
  // it — skipped rather than plotted as a misleading zero.
  value: (p: PromptTurn) => number | null;
  // The header chip's value, given every request. A metric whose headline is a property
  // of the *scope* rather than of one call supplies this so the chip reads the aggregate
  // (matching the Overview) rather than the last request's value: a per-request share
  // swings call to call, so the final point can read 0% on a run that was 8% overall, and
  // a rate read off one short reply reads nothing like the rate the scope generated at.
  // Omit — as the genuinely per-request cost does — to fall back to the latest plotted
  // point.
  summary?: (prompts: readonly PromptTurn[]) => number | null;
  // The value chip's formatting (a fraction for the percentage metrics).
  formatValue: (v: number) => string;
  // d3-format spec (or function) for the y-axis ticks.
  yTickFormat: string | ((v: number) => string);
  // A fixed y ceiling — the share metrics frame to 1 (100%) rather than to their
  // tallest observation. Omit to let the data size the scale.
  yMax?: number;
  // The figures the plotted value was computed from, shown under it in the point's
  // hover tooltip — what a single dot cannot say for itself. Called only for a
  // request the metric has a value for, so it may assume its inputs are present.
  detail?: (p: PromptTurn) => readonly string[];
}

// The tokens a turn generated: everything the model produced during the call
// (output plus any separately-reported reasoning), the numerator of throughput.
function generatedTokens(p: PromptTurn): number {
  return (p.tokens.output ?? 0) + (p.tokens.reasoning ?? 0);
}

// The tokens a turn sent: both input classes together, cached and not — the basis
// of the request's input cost and the denominator of its cache-read share.
function inputTokens(p: PromptTurn): number {
  return (p.tokens.cachedInput ?? 0) + (p.tokens.uncachedInput ?? 0);
}

// The scope's generation rate over every request it timed: everything it generated over
// the time it spent inside its model calls. This is the same accounting the agent's
// Overview and the Dashboard's Tokens / s card state (`agentThroughput` /
// `deriveGgThroughput`) — the two read the rate off `turn_timing`'s `requestMs`, which is
// the same figure per turn as the `prompt`'s `durationMs` this sums — so the chip agrees
// with them instead of contradicting them.
//
// It has to be the aggregate rather than the last plotted point: a rate is a ratio of two
// sums, and the *last* request of a run is characteristically the least representative one
// — a two-line `finish` reply pays the same fixed round-trip as a working turn and so reads
// several times slower than the run ever generated. Untimed requests are skipped, exactly
// as the graph skips them, so the chip summarizes the points that are actually drawn.
function overallThroughput(prompts: readonly PromptTurn[]): number | null {
  let generated = 0;
  let ms = 0;
  for (const p of prompts) {
    if (p.durationMs == null || p.durationMs <= 0) continue;
    generated += generatedTokens(p);
    ms += p.durationMs;
  }
  return ms > 0 ? generated / (ms / 1000) : null;
}

// Reasoning tokens as a share of all generated output over the whole run — the same
// aggregate the agent's Overview reports (reasoning / (output + reasoning)), summed
// across every request. Null when no request reported reasoning at all (the class is
// folded into output), so the chip reads empty rather than a misleading 0%.
function reasoningShare(prompts: readonly PromptTurn[]): number | null {
  let reasoning = 0;
  let output = 0;
  let reported = false;
  for (const p of prompts) {
    if (p.tokens.reasoning != null) {
      reasoning += p.tokens.reasoning;
      reported = true;
    }
    output += p.tokens.output ?? 0;
  }
  if (!reported) return null;
  const total = output + reasoning;
  return total > 0 ? reasoning / total : null;
}

// Cached input as a share of all input over the whole run — the run-level aggregate,
// so the chip agrees with the Overview rather than swinging with the last request.
function cacheReadShare(prompts: readonly PromptTurn[]): number | null {
  let cached = 0;
  let uncached = 0;
  let reported = false;
  for (const p of prompts) {
    const { cachedInput, uncachedInput } = p.tokens;
    if (cachedInput != null) {
      cached += cachedInput;
      reported = true;
    }
    if (uncachedInput != null) {
      uncached += uncachedInput;
      reported = true;
    }
  }
  if (!reported) return null;
  const total = cached + uncached;
  return total > 0 ? cached / total : null;
}

// The four per-request metrics, in grid order.
export const METRICS: readonly MetricDef[] = [
  {
    key: "throughput",
    label: "Tokens / s",
    color: "#6ea8fe",
    value: (p) =>
      p.durationMs != null && p.durationMs > 0
        ? generatedTokens(p) / (p.durationMs / 1000)
        : null,
    // The chip is the scope's own rate — its whole generation over its whole model time,
    // the figure the Overview's tok/s states — not the last request's, which is a rate the
    // scope never ran at (see `overallThroughput`).
    summary: overallThroughput,
    // The same rate the Dashboard's Tokens / s card states for the whole run, spelled the
    // same way — this graph is that figure per request.
    formatValue: formatThroughput,
    yTickFormat: "~s",
    // The rate's two halves: a slow request that generated a lot is a different
    // problem from one that generated little, and the rate alone cannot tell them
    // apart. `durationMs` is non-null for any request with a throughput.
    detail: (p) => [
      `${tokens(generatedTokens(p))} in ${formatMs(p.durationMs!)}`,
    ],
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
    // What the price was charged for, and — when the harness reports its own exact
    // cost and it differs from the comparable figure plotted — what was actually
    // billed, so the point is never mistaken for the invoice.
    detail: (p) => {
      const lines = [
        `${tokens(inputTokens(p))} in, ${tokens(generatedTokens(p))} out`,
      ];
      const { comparable, actual } = p.cost ?? {};
      if (comparable != null && actual != null && actual !== comparable) {
        lines.push(`the provider charged ${formatCost(actual)}`);
      }
      return lines;
    },
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
    summary: cacheReadShare,
    formatValue: formatPercent,
    yTickFormat: ".0%",
    yMax: 1,
    // The share's numerator and denominator: 60% of a small prompt and 60% of a
    // huge one are the same point on the line and nothing like the same request.
    detail: (p) => [
      `${tokenFmt.format(p.tokens.cachedInput ?? 0)} cached of ${tokens(inputTokens(p))} sent`,
    ],
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
    summary: reasoningShare,
    formatValue: formatPercent,
    yTickFormat: ".0%",
    yMax: 1,
    // The share's numerator and denominator, for the same reason as cache read.
    // `reasoning` is non-null for any request with a value here.
    detail: (p) => [
      `${tokenFmt.format(p.tokens.reasoning!)} reasoning of ${tokens(generatedTokens(p))} generated`,
    ],
  },
];

// One point's tooltip: the turn, the value plotted, and the figures behind it. The
// turn leads because it is what ties this point to the same turn on the Context and
// Time-per-turn graphs, which is how a reader gets from "this request was slow" to
// why.
export function tooltipFor(
  metric: MetricDef,
  prompt: PromptTurn,
  value: number,
): string {
  return [
    `Turn ${prompt.turn} — ${metric.formatValue(value)}`,
    ...(metric.detail?.(prompt) ?? []),
  ].join("\n");
}

export function RequestMetricsGraphs({
  prompts,
  timings = [],
}: {
  prompts: PromptTurn[];
  // Per-turn phase timings, which head the file. Unlike the metrics below them these
  // are not per-*request*: a turn is timed whether or not it reached the model, so a
  // run can have timings before it has a single request.
  timings?: TurnTiming[];
}) {
  if (prompts.length === 0 && timings.length === 0) {
    return (
      <p className={styles.empty}>
        No requests yet — each metric gains a data point per model call.
      </p>
    );
  }
  return (
    <div className={styles.stack}>
      <div className={styles.metricsGrid}>
        {/* Where the time went leads the file: it is the graph that says which of the
            three phases a slow run is slow in, which the value-per-call metrics below
            it cannot answer. */}
        <TurnTimingGraph timings={timings} />
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
  // The metric's non-null observations on the turn axis, each carrying its hover
  // tooltip. A request with no datum is skipped, so a graph that plots N of M
  // requests is honest about which had one.
  const points = useMemo<MetricPoint[]>(() => {
    const out: MetricPoint[] = [];
    for (const p of prompts) {
      const value = metric.value(p);
      if (value != null && Number.isFinite(value))
        out.push({ turn: p.turn, value, title: tooltipFor(metric, p, value) });
    }
    return out;
  }, [metric, prompts]);

  // The header chip: the scope-level aggregate for a metric that has one — the rate and
  // the two shares, so each agrees with the Overview — else the latest plotted point.
  const chip = metric.summary
    ? metric.summary(prompts)
    : points.length
      ? points[points.length - 1]!.value
      : null;

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
        {chip != null && (
          <span className={styles.metricCardLatest}>
            {metric.formatValue(chip)}
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
