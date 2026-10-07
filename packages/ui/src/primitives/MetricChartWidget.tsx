import { useMemo, useState, type ReactNode } from "react";
import type { RunSummary } from "@clockwyrks/run-record/snapshot";
import { canonicalModelId } from "../modelId";
import { ChartWidget } from "./ChartWidget";
import { ChartModeControl, type ChartMode } from "./ChartModeControl";
import {
  orderBars,
  type BetterIs,
  type ChartSort,
  type ChartTieBreak,
} from "./chartSort";
import { barChart, scatterChart } from "./plot/charts";
import type { BarPoint, DistributionPoint, ScatterGroup } from "./plot/charts";
import { summarizeValues, type DistributionStats } from "./plot/distribution";
import type { ChartPalette } from "./plot/theme";

// Tilt the model labels so a large roster fits along the axis without overlap.
const LABEL_ROTATE = -40;

/**
 * How the bar chart reduces runs to bars:
 * - `perRun`: one bar per run, labeled by its `(model, harness)` (the raw
 *   magnitudes).
 * - `meanByModel`: one bar per `(harness, model)` pair, the mean of that pair's
 *   runs. Named for history — the grouping is by harness *and* model, so the same
 *   model under two harnesses is two bars, never one merged average.
 */
type BarMode = "perRun" | "meanByModel";

// Joins a group's two axes into a stable map key. NUL can't occur in a slug or
// model id, so it never collides two real pairs.
const KEY_SEP = "\u0000";

/**
 * The presentation callbacks both bar builders take. Grouped into one bag
 * because they are all optional and all describe *how a run is rendered* rather
 * than what is being measured — as five trailing positional parameters, a caller
 * that needed the last one had to count `undefined`s to reach it.
 */
export interface BarBuildOptions {
  /**
   * Resolves a run's `modelId` to a bar color (e.g. its provider's brand color).
   * Return null/undefined for an unknown model and the bar keeps the theme
   * accent. Omit entirely to color every bar with the accent.
   */
  colorForModel?: (modelId: string) => string | null | undefined;
  /**
   * Resolves a run's (canonicalized) `modelId` to the label shown on its bar —
   * e.g. the catalog display name ("Anthropic Claude Opus 4.8") in place of the
   * raw id. Return null/undefined for a model with no better label and the bar
   * falls back to the canonical id. Omit entirely to label every bar by its id.
   */
  labelForModel?: (modelId: string) => string | null | undefined;
  /**
   * An optional extra grouping axis appended to the `(harness, model)` fold —
   * e.g. the engine a run selected, when a case's metrics are widened across
   * engines. Runs whose subgroup keys differ are never folded into one bar
   * (they measure different work), and each bar's label carries the subgroup's
   * label after the harness. Omit for the plain pair fold.
   */
  subgroup?: (run: RunSummary) => { key: string; label: string };
  /**
   * Where a run's own page lives. Set it and each run's dot in the scatter view
   * is drawn inside a link, so a reader who spots an outlier opens the run that
   * produced it rather than going to find it in a list. Return null for a run
   * with nowhere to go.
   */
  runHref?: (run: RunSummary) => string | null | undefined;
  /**
   * One extra line of identity for a run's dot in the scatter view — when it
   * ran, typically. The widget already names the group, the value and the run
   * id; this is where a caller adds what only it can format.
   */
  describeRun?: (run: RunSummary) => string | null | undefined;
}

// The label a bar carries: the model's display name disambiguated by the harness
// that produced it ("Anthropic Claude Opus 4.8 · pi"). The harness is always
// shown because a `(harness, model)` pair is the unit these charts plot — the
// whole point of the split is that which harness ran is never hidden. A caller
// splitting on an extra axis (see `subgroup`) appends that axis's label the same
// way ("… · pi · Simple 2D"), so a split bar names what it was split on.
function pairLabel(
  modelName: string,
  harnessSlug: string,
  subLabel?: string,
): string {
  const pair = `${modelName} · ${harnessSlug}`;
  return subLabel ? `${pair} · ${subLabel}` : pair;
}

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
   * Offers the reader a per-chart Bar/Scatter control, and gives the bar view the
   * hover swap (a hovered bar becomes the box-and-whiskers of the runs it
   * averages). Only meaningful for `meanByModel`, which is the only mode whose
   * bars stand for several runs; ignored otherwise.
   *
   * The choice is this widget's own state on purpose — see {@link ChartModeControl}.
   */
  distributionModes?: boolean;
  /**
   * Formats a raw metric value for the hover tooltip (e.g. a compact token count
   * or a USD figure). Drives the summary lines shown when a bar is hovered, and
   * every per-run figure in the scatter view. Defaults to a plain localized
   * integer.
   */
  formatValue?: (value: number) => string;
  /**
   * The bar order. Defaults to `alphabetical` — the order Plot infers on its own
   * — so a caller that has no order control keeps the roster it always had.
   */
  sort?: ChartSort;
  /**
   * Which end of this metric is better, for the `best` order. Defaults to
   * `lower` (cost, tokens); pass `higher` for a metric where more is better
   * (points).
   */
  betterIs?: BetterIs;
  /** Mean points per bar label, splitting `best`-order ties. */
  tieBreak?: ChartTieBreak;
  /** Controls for the widget header's trailing edge (e.g. the order control). */
  actions?: ReactNode;
  /**
   * Shown in place of the chart when no run yielded a value. Omit to plot an
   * empty chart instead (the shape a metric every run reports never reaches).
   */
  empty?: string;
}

// A self-contained metric chart: a titled, full-width panel that charts one
// metric grouped by `(harness, model)` — one bar per pair (the mean) or one per
// run, per `barMode`. The title carries the unit prominently (the axis label
// alone is easy to miss). Like every chart here it shows magnitudes, never a
// ranking, and never merges two harnesses of a model into one bar.
//
// With `distributionModes` the widget also carries its own Bar/Scatter control:
// the bar view swaps a hovered bar for the box-and-whiskers behind it, and the
// scatter view draws every run as a dot on its group's average. Both read the
// same fold — the mean a bar draws is the rule a scatter draws — so flipping
// between them never changes the figure, only how much of it is shown.
export function MetricChartWidget({
  title,
  runs,
  value,
  unit,
  yTickFormat,
  barMode = "perRun",
  distributionModes = false,
  colorForModel,
  labelForModel,
  formatValue = defaultFormatValue,
  sort = "alphabetical",
  betterIs = "lower",
  tieBreak,
  actions,
  empty,
  subgroup,
  runHref,
  describeRun,
}: MetricChartWidgetProps & BarBuildOptions) {
  // Per-chart, never lifted: two charts on one page may honestly want different
  // views of the same roster (see `ChartModeControl`).
  const [mode, setMode] = useState<ChartMode>("bar");
  // Only a mean bar stands for more than one run, so only `meanByModel` has a
  // distribution to show. A `perRun` chart's "scatter" would be its own bars.
  const modal = distributionModes && barMode === "meanByModel";
  const scatter = modal && mode === "scatter";

  const build = useMemo<BarBuildOptions>(
    () => ({ colorForModel, labelForModel, subgroup, runHref, describeRun }),
    [colorForModel, labelForModel, subgroup, runHref, describeRun],
  );

  const barPoints = useMemo<BarPoint[]>(
    () =>
      barMode === "meanByModel"
        ? meanBars(runs, value, formatValue, build)
        : runBars(runs, value, formatValue, build),
    [runs, value, barMode, formatValue, build],
  );

  // The bars in the chosen order. Kept separate from building them so flipping
  // the order re-sorts without re-folding every run.
  const ordered = useMemo(
    () =>
      orderBars(
        barPoints,
        sort,
        (bar) => bar.label,
        (bar) => bar.value,
        betterIs,
        tieBreak,
      ),
    [barPoints, sort, betterIs, tieBreak],
  );

  // Memoized so <Chart> only re-plots when the data, order, mode or unit change.
  // The x domain is stated explicitly (deduped — `perRun` mode puts several runs
  // of one pair on the same band) because Plot sorts a domain it infers itself,
  // which would silently override the order chosen above. Both modes take the
  // same domain, so switching between them never moves a label.
  const spec = useMemo(() => {
    const labels = {
      y: unit,
      yTickFormat,
      xTickRotate: LABEL_ROTATE,
      xDomain: [...new Set(ordered.map((bar) => bar.label))],
    };
    if (scatter) {
      const groups = scatterGroups(ordered);
      return (palette: ChartPalette) =>
        scatterChart(groups, palette, { ...labels, formatValue });
    }
    return (palette: ChartPalette) => barChart(ordered, palette, labels);
  }, [ordered, unit, yTickFormat, scatter, formatValue]);

  const modeControl = modal ? (
    <ChartModeControl
      value={mode}
      onChange={setMode}
      ariaLabel={`${title} display`}
    />
  ) : null;

  return (
    <ChartWidget
      title={title}
      chartTitle={chartTitle(title, barMode, scatter)}
      actions={
        modeControl || actions ? (
          <>
            {modeControl}
            {actions}
          </>
        ) : undefined
      }
      spec={empty && ordered.length === 0 ? undefined : spec}
      empty={empty}
    />
  );
}

// The chart's accessible name: what it plots, and how — a reader on a screen
// reader has no way to see that the figure switched to one dot per run.
function chartTitle(title: string, barMode: BarMode, scatter: boolean): string {
  const subject = `${title} by harness & model`;
  if (scatter) return `${subject} (every run)`;
  return barMode === "meanByModel" ? subject : `${subject} (per run)`;
}

// Turns the ordered bars into the scatter's groups. Every bar built by
// `meanBars` carries its distribution, so this is a projection rather than a
// second fold — the rule a group draws IS the bar's height.
function scatterGroups(bars: readonly BarPoint[]): ScatterGroup[] {
  return bars.flatMap((bar) =>
    bar.distribution
      ? [
          {
            label: bar.label,
            color: bar.color,
            mean: bar.distribution.mean,
            points: bar.distribution.points,
          },
        ]
      : [],
  );
}

// Builds one labeled bar per run. Every bar is labeled by its `(model, harness)`
// pair — the resolved model name (falling back to the canonical id) followed by
// the harness slug — so two runs of the same model under different harnesses are
// never conflated. Model ids are canonicalized (harness-aware) first, so an
// `openrouter/`-prefixed or `:tag`-suffixed run and its bare equivalent count as
// the same model. Runs whose value is unknown (`null`) are dropped so they don't
// appear as zero bars.
//
// A per-run bar IS its own observation, so it carries no distribution: there is
// no spread behind a bar that stands for exactly one run, and asserting one would
// be a fabrication.
//
// Exported for tests (the harness-split invariant is the point of this widget).
export function runBars(
  runs: RunSummary[],
  value: (run: RunSummary) => number | null,
  formatValue: (value: number) => string,
  options: BarBuildOptions = {},
): BarPoint[] {
  const { colorForModel, labelForModel, subgroup } = options;
  return runs.flatMap((run) => {
    const v = value(run);
    if (v === null) return [];
    const harness = run.subject.harnessSlug;
    const modelId = canonicalModelId(run.subject.modelId, harness);
    const name = labelForModel?.(modelId) ?? modelId;
    const label = pairLabel(name, harness, subgroup?.(run).label);
    return [
      {
        label,
        value: v,
        color: colorForModel?.(modelId) ?? undefined,
        title: `${label}\n${formatValue(v)}`,
      },
    ];
  });
}

// Builds one bar per `(harness, model)` pair: the mean of `value` across that
// pair's runs, i.e. the average per run. Grouping is by harness *and* model, so
// the same model under two harnesses stays two bars — a
// [design invariant](/comparisons/metrics-split/): a model run under two
// harnesses is two different things and must never merge into one average. Model
// ids are canonicalized (harness-aware) first, so an `openrouter/`-prefixed or
// `:tag`-suffixed run and its bare equivalent aggregate into the same bar. Pairs
// keep their first-seen order. Bars are labeled `<model> · <harness>` and colored
// by the model's provider (so one model's several harness bars share a hue,
// distinguished by their labels). Runs whose value is unknown (`null`) are
// excluded from the mean; a pair with no known values gets no bar at all rather
// than a misleading zero.
//
// Every bar keeps the runs it averaged, summarized on
// [the repository's one convention](/comparisons/statistics/) and listed
// individually. That is what lets the widget swap a hovered bar for its
// box-and-whiskers and draw a dot per run — a mean that has thrown its
// observations away can do neither.
//
// Exported for tests (the harness-split invariant is the point of this widget).
export function meanBars(
  runs: RunSummary[],
  value: (run: RunSummary) => number | null,
  formatValue: (value: number) => string,
  options: BarBuildOptions = {},
): BarPoint[] {
  const { colorForModel, labelForModel, subgroup, runHref, describeRun } =
    options;
  interface Observation {
    value: number;
    runId: string;
    href: string | undefined;
    detail: string | undefined;
  }
  interface Group {
    modelId: string;
    harness: string;
    subLabel: string | undefined;
    observations: Observation[];
  }
  const totals = new Map<string, Group>();
  const order: string[] = [];
  for (const run of runs) {
    const v = value(run);
    if (v === null) continue;
    const harness = run.subject.harnessSlug;
    const modelId = canonicalModelId(run.subject.modelId, harness);
    const sub = subgroup?.(run);
    // The subgroup key joins the fold key the same NUL-separated way, so two
    // runs of one pair under different subgroups are two bars, never one mean.
    const key =
      `${harness}${KEY_SEP}${modelId}` + (sub ? `${KEY_SEP}${sub.key}` : "");
    let entry = totals.get(key);
    if (!entry) {
      entry = { modelId, harness, subLabel: sub?.label, observations: [] };
      totals.set(key, entry);
      order.push(key);
    }
    entry.observations.push({
      value: v,
      runId: run.id,
      href: runHref?.(run) ?? undefined,
      detail: describeRun?.(run) ?? undefined,
    });
  }
  return order.flatMap((key) => {
    const { modelId, harness, subLabel, observations } = totals.get(key)!;
    const stats = summarizeValues(observations.map((o) => o.value));
    // Unreachable: a group exists only because a run landed in it. Guarded
    // rather than asserted so an empty sample can never become a zero bar.
    if (!stats) return [];
    const name = labelForModel?.(modelId) ?? modelId;
    const label = pairLabel(name, harness, subLabel);
    return [
      {
        label,
        value: stats.mean,
        color: colorForModel?.(modelId) ?? undefined,
        title: meanTitle(label, stats, formatValue),
        distribution: {
          ...stats,
          points: observations.map((observation) =>
            runPoint(observation, label, stats, formatValue),
          ),
        },
      },
    ];
  });
}

// The tooltip a mean bar carries: its sample size, the mean it is drawing, and
// the spread that single height hides — which is also what the hover swap draws,
// so the box and the words agree.
//
// A one-run bar says so and stops. It has a value, not a distribution, and
// printing "Median" and "Range" over one observation would dress a single number
// up as a summary of several.
function meanTitle(
  label: string,
  stats: DistributionStats,
  formatValue: (value: number) => string,
): string {
  if (stats.n === 1) {
    return `${label} · ${runCount(stats.n)}\n${formatValue(stats.mean)}`;
  }
  return (
    `${label} · ${runCount(stats.n)}\n` +
    `Mean: ${formatValue(stats.mean)}\n` +
    `Median: ${formatValue(stats.median)}\n` +
    `IQR: ${formatValue(stats.q1)} – ${formatValue(stats.q3)}\n` +
    `Range: ${formatValue(stats.min)} – ${formatValue(stats.max)}`
  );
}

// One run's dot in the scatter view, with the tooltip that identifies it. A
// reader hovering a dot is asking "which run is that?", so the tip names the
// group, the run's own figure, whatever the caller can say about when it ran,
// the average it is being read against, and the run id itself.
function runPoint(
  observation: {
    value: number;
    runId: string;
    href: string | undefined;
    detail: string | undefined;
  },
  label: string,
  stats: DistributionStats,
  formatValue: (value: number) => string,
): DistributionPoint {
  const lines = [
    label,
    formatValue(observation.value),
    ...(observation.detail ? [observation.detail] : []),
    `Group mean: ${formatValue(stats.mean)} · ${runCount(stats.n)}`,
    `run ${observation.runId}`,
  ];
  return {
    runId: observation.runId,
    value: observation.value,
    href: observation.href,
    title: lines.join("\n"),
  };
}

// "1 run" / "4 runs" — the sample size, always stated, never implied.
function runCount(n: number): string {
  return `${n} ${n === 1 ? "run" : "runs"}`;
}

// Fallback tooltip formatter: a plain localized integer. Callers pass a
// unit-aware formatter (compact tokens, USD) via `formatValue`.
function defaultFormatValue(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}
