import { useMemo, type ReactNode } from "react";
import type { RunSummary } from "@test-cabinet/run-record/snapshot";
import { canonicalModelId } from "../modelId";
import { ChartWidget } from "./ChartWidget";
import {
  orderBars,
  type BetterIs,
  type ChartSort,
  type ChartTieBreak,
} from "./chartSort";
import { barChart } from "./plot/charts";
import type { BarPoint } from "./plot/charts";
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

// The label a bar carries: the model's display name disambiguated by the harness
// that produced it ("Anthropic Claude Opus 4.8 · pi"). The harness is always
// shown because a `(harness, model)` pair is the unit these charts plot — the
// whole point of the split is that which harness ran is never hidden.
function pairLabel(modelName: string, harnessSlug: string): string {
  return `${modelName} · ${harnessSlug}`;
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
   * Formats a raw metric value for the hover tooltip (e.g. a compact token count
   * or a USD figure). Drives the max/min (and mean) lines shown when a bar is
   * hovered. Defaults to a plain localized integer.
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
export function MetricChartWidget({
  title,
  runs,
  value,
  unit,
  yTickFormat,
  barMode = "perRun",
  colorForModel,
  labelForModel,
  formatValue = defaultFormatValue,
  sort = "alphabetical",
  betterIs = "lower",
  tieBreak,
  actions,
  empty,
}: MetricChartWidgetProps) {
  const barPoints = useMemo<BarPoint[]>(
    () =>
      barMode === "meanByModel"
        ? meanBars(runs, value, formatValue, colorForModel, labelForModel)
        : runBars(runs, value, formatValue, colorForModel, labelForModel),
    [runs, value, barMode, formatValue, colorForModel, labelForModel],
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

  // Memoized so <Chart> only re-plots when the data, order, or unit change. The
  // x domain is stated explicitly (deduped — `perRun` mode puts several runs of
  // one pair on the same band) because Plot sorts a domain it infers itself,
  // which would silently override the order chosen above.
  const spec = useMemo(() => {
    const labels = {
      y: unit,
      yTickFormat,
      xTickRotate: LABEL_ROTATE,
      xDomain: [...new Set(ordered.map((bar) => bar.label))],
    };
    return (palette: ChartPalette) => barChart(ordered, palette, labels);
  }, [ordered, unit, yTickFormat]);

  return (
    <ChartWidget
      title={title}
      chartTitle={`${title} by harness & model${
        barMode === "meanByModel" ? "" : " — per run"
      }`}
      actions={actions}
      spec={empty && ordered.length === 0 ? undefined : spec}
      empty={empty}
    />
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
// Exported for tests (the harness-split invariant is the point of this widget).
export function runBars(
  runs: RunSummary[],
  value: (run: RunSummary) => number | null,
  formatValue: (value: number) => string,
  colorForModel?: (modelId: string) => string | null | undefined,
  labelForModel?: (modelId: string) => string | null | undefined,
): BarPoint[] {
  return runs.flatMap((run) => {
    const v = value(run);
    if (v === null) return [];
    const harness = run.subject.harnessSlug;
    const modelId = canonicalModelId(run.subject.modelId, harness);
    const name = labelForModel?.(modelId) ?? modelId;
    const label = pairLabel(name, harness);
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
// Exported for tests (the harness-split invariant is the point of this widget).
export function meanBars(
  runs: RunSummary[],
  value: (run: RunSummary) => number | null,
  formatValue: (value: number) => string,
  colorForModel?: (modelId: string) => string | null | undefined,
  labelForModel?: (modelId: string) => string | null | undefined,
): BarPoint[] {
  interface Group {
    modelId: string;
    harness: string;
    sum: number;
    count: number;
    min: number;
    max: number;
  }
  const totals = new Map<string, Group>();
  const order: string[] = [];
  for (const run of runs) {
    const v = value(run);
    if (v === null) continue;
    const harness = run.subject.harnessSlug;
    const modelId = canonicalModelId(run.subject.modelId, harness);
    const key = `${harness}${KEY_SEP}${modelId}`;
    const entry = totals.get(key);
    if (entry) {
      entry.sum += v;
      entry.count += 1;
      entry.min = Math.min(entry.min, v);
      entry.max = Math.max(entry.max, v);
    } else {
      totals.set(key, { modelId, harness, sum: v, count: 1, min: v, max: v });
      order.push(key);
    }
  }
  return order.map((key) => {
    const { modelId, harness, sum, count, min, max } = totals.get(key)!;
    const name = labelForModel?.(modelId) ?? modelId;
    const label = pairLabel(name, harness);
    // The bar height is the mean; the tooltip surfaces the spread it hides — the
    // max and min behind it — over however many runs it averages.
    const runsLine = `${count} ${count === 1 ? "run" : "runs"}`;
    return {
      label,
      value: sum / count,
      color: colorForModel?.(modelId) ?? undefined,
      title:
        `${label} · ${runsLine}\n` +
        `Mean: ${formatValue(sum / count)}\n` +
        `Max: ${formatValue(max)}\n` +
        `Min: ${formatValue(min)}`,
    };
  });
}

// Fallback tooltip formatter: a plain localized integer. Callers pass a
// unit-aware formatter (compact tokens, USD) via `formatValue`.
function defaultFormatValue(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}
