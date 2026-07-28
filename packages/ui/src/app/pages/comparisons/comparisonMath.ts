// Pure helpers behind the comparison detail page's "Trigger missing runs" action
// and its charts — kept free of React/network so the top-up math and the
// tool-call grouping are unit-tested directly (see comparisonMath.test.ts).
import type {
  ComparisonArm,
  ComparisonConfig,
} from "@test-cabinet/run-record/comparison";
import type { StackedBarSegment, StackedSeries } from "../../../primitives";
import { OPENROUTER_PROVIDER, resolveLaunchModel } from "../../data/providers";
import { DEFAULT_ORCHESTRATOR_SLUG } from "../../data/orchestrators";
import type { LaunchItem } from "../runs/launchBatch";
import { categoricalColor } from "./armColors";

/**
 * How many more runs an arm still needs to reach the comparison's `N`, counted
 * off the arm's own recorded `runIds` — the source of truth for what has already
 * been launched — never off `nObserved` (the aggregated result's count of runs
 * that have actually reported back). Using `nObserved` would re-launch an arm's
 * still-in-flight runs every time the page is opened before they complete.
 */
export function remainingForArm(n: number, arm: ComparisonArm): number {
  return Math.max(0, n - (arm.runIds?.length ?? 0));
}

/** The controls a launch needs, independent of which are held constant by this
 * particular comparison (a subset of `ComparisonControls`). */
interface LaunchControls {
  caseSlug: string;
  version: string;
  variant: string;
}

/**
 * Build the launch items for a **harness** arm's still-missing runs: `count`
 * copies of the one (case, version, variant, harness, model, orchestrator) tuple
 * the comparison's controls and this arm fix. Mirrors `itemsForCells`
 * (`CoveragePlanPage`) and the new-run form's per-combination launch config —
 * the same one-shot orchestrator, since a comparison does not vary it. Returns
 * no items when the arm or the controls are missing what a harness arm needs
 * (its own `harnessSlug`, and the controls' pinned `modelId`).
 */
export function harnessArmLaunchItems(
  controls: LaunchControls & { modelId?: string },
  arm: ComparisonArm,
  count: number,
): LaunchItem[] {
  const harness = arm.harnessSlug;
  const modelId = controls.modelId;
  if (!harness || !modelId || count <= 0) return [];
  return Array.from({ length: count }, () => ({
    config: {
      testCase: controls.caseSlug,
      version: controls.version,
      variant: controls.variant,
      harness,
      modelId: resolveLaunchModel(harness, OPENROUTER_PROVIDER, modelId),
      orchestrator: DEFAULT_ORCHESTRATOR_SLUG,
      maxRuntimeOverride: null,
    },
    track: {
      testCaseSlug: controls.caseSlug,
      testCaseVersion: controls.version,
      variant: controls.variant,
      harnessSlug: harness,
      modelId,
    },
  }));
}

/**
 * Build the launch items for a **model** arm's still-missing runs: `count`
 * copies under `harness`, held constant across every model arm. The contract's
 * `ComparisonControls` (`@test-cabinet/run-record/comparison`) has no harness
 * field of its own — only a harness-varied comparison names one per arm — so the
 * pinned harness for a model-varied comparison is collected by the create form
 * alongside the controls and passed in here explicitly rather than read off the
 * stored config.
 */
export function modelArmLaunchItems(
  controls: LaunchControls,
  harness: string,
  arm: ComparisonArm,
  count: number,
): LaunchItem[] {
  const modelId = arm.modelId;
  if (!harness || !modelId || count <= 0) return [];
  return Array.from({ length: count }, () => ({
    config: {
      testCase: controls.caseSlug,
      version: controls.version,
      variant: controls.variant,
      harness,
      modelId: resolveLaunchModel(harness, OPENROUTER_PROVIDER, modelId),
      orchestrator: DEFAULT_ORCHESTRATOR_SLUG,
      maxRuntimeOverride: null,
    },
    track: {
      testCaseSlug: controls.caseSlug,
      testCaseVersion: controls.version,
      variant: controls.variant,
      harnessSlug: harness,
      modelId,
    },
  }));
}

/**
 * Fold a batch of launch results into an arm's `runIds`: append every
 * successfully-launched run's id, in the order launched, skipping an exact
 * duplicate (defensive — a launch is never expected to repeat an id) and
 * dropping the failures (a rejected combination was never enqueued, so it must
 * not be recorded as one of the arm's runs). This is the entire "top-up" write —
 * pure, so it is tested without a network.
 */
export function appendRunIds(
  existing: readonly string[] | undefined,
  launched: readonly { runId?: string; error?: string }[],
): string[] {
  const next = [...(existing ?? [])];
  for (const result of launched) {
    if (result.runId && !next.includes(result.runId)) next.push(result.runId);
  }
  return next;
}

/**
 * Replace one arm's `runIds` in a comparison's config, immutably — the shape
 * "Trigger missing runs" PUTs back after topping an arm up. Every other arm is
 * left untouched; unknown `armId` is a no-op (defensive — the detail page only
 * ever calls this with an arm id it just read off the same config).
 */
export function withArmRunIds(
  config: ComparisonConfig,
  armId: string,
  runIds: readonly string[],
): ComparisonConfig {
  return {
    ...config,
    arms: config.arms.map((arm) =>
      arm.id === armId ? { ...arm, runIds: [...runIds] } : arm,
    ),
  };
}

/**
 * The ratio a two-arm comparison presents as a plain number — "arm's median
 * cost is ~R× the other's" (docs/comparisons/statistics.md, "Comparing two
 * arms") — never a verdict, just the division. `NaN` when the denominator is
 * zero; a caller should simply omit the ratio rather than print it in that case.
 */
export function medianRatio(aMedian: number, bMedian: number): number {
  return bMedian === 0 ? NaN : aMedian / bMedian;
}

/** One arm's raw tool-call tally, as carried on `ComparisonArmResult.diagnostics.
 * toolCalls` — the input to {@link toolCallChartData}. */
export interface ArmToolCalls {
  armLabel: string;
  toolCalls: Readonly<Record<string, number>>;
}

// Cap the tool-name series a stacked chart draws explicitly; per the dataviz
// non-negotiable a categorical series count beyond what the validated palette
// covers folds into "other" rather than generating an unchecked color.
const MAX_TOOL_SERIES = 6;
const OVERFLOW_SERIES_NAME = "other";

/**
 * Turn each arm's raw tool-call tally into the stacked-bar-chart shape
 * (`stackedBarChart`, `packages/ui/src/primitives/plot/charts.ts`): one segment
 * per `(arm, tool)`, plus the fixed `series` list (name + color) that both fixes
 * the stacking/legend order and caps it at {@link MAX_TOOL_SERIES}. The kept
 * tools are the top callers **by total across every arm** — so the same tool
 * lands in the same series regardless of which arm is listed first — and every
 * tool past that cutoff is summed into a trailing "other" series rather than
 * spilling into an uncapped, uncheckable legend. Every non-zero count carries a
 * tooltip with the arm's full per-tool breakdown, mirroring
 * `RatingsChartWidget`'s stacked-segment tooltips. A tool with zero calls in a
 * given arm gets no segment for that arm (nothing to stack), matching
 * `ratingSegments`.
 */
export function toolCallChartData(arms: readonly ArmToolCalls[]): {
  segments: StackedBarSegment[];
  series: StackedSeries[];
} {
  const totals = new Map<string, number>();
  for (const arm of arms) {
    for (const [name, count] of Object.entries(arm.toolCalls)) {
      totals.set(name, (totals.get(name) ?? 0) + count);
    }
  }
  const ranked = [...totals.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => name);
  const kept = ranked.slice(0, MAX_TOOL_SERIES);
  const overflow = ranked.slice(MAX_TOOL_SERIES);
  const names = overflow.length > 0 ? [...kept, OVERFLOW_SERIES_NAME] : kept;

  const series: StackedSeries[] = names.map((name, i) => ({
    name,
    color: categoricalColor(i),
  }));

  const segments: StackedBarSegment[] = arms.flatMap((arm) => {
    const rows = names.map((name) => ({
      name,
      value:
        name === OVERFLOW_SERIES_NAME
          ? overflow.reduce((sum, n) => sum + (arm.toolCalls[n] ?? 0), 0)
          : (arm.toolCalls[name] ?? 0),
    }));
    const nonZero = rows.filter((r) => r.value > 0);
    const title = [
      arm.armLabel,
      ...nonZero.map((r) => `${r.name}: ${r.value}`),
    ].join("\n");
    return nonZero.map((r) => ({
      group: arm.armLabel,
      series: r.name,
      value: r.value,
      title,
    }));
  });

  return { segments, series };
}
