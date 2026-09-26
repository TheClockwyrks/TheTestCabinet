// Pure helpers behind the comparison detail page's "Trigger missing runs" action
// and its charts — kept free of React/network so the top-up math and the
// tool-call grouping are unit-tested directly (see comparisonMath.test.ts).
import type {
  ComparisonArm,
  ComparisonArmResult,
  ComparisonConfig,
} from "@clockwyrks/run-record/comparison";
import type {
  DistributionGroup,
  StackedBarSegment,
  StackedSeries,
} from "../../../primitives";
import { OPENROUTER_PROVIDER, resolveLaunchModel } from "../../data/providers";
import { DEFAULT_ORCHESTRATOR_SLUG } from "../../data/orchestrators";
import { resolveEngineSlug } from "../../data/engines";
import type { LaunchItem } from "../runs/launchBatch";
import { categoricalColor } from "../../../primitives/plot/palette";

/**
 * The arm's recorded runs that **still exist** — a run is stored for it, or a job
 * for it is still queued or running — exactly as the backend reported them, or
 * `undefined` when it did not report them at all.
 *
 * Three states, and the third is not the second:
 *
 * - `undefined` — **liveness was never reported**. A backend older than the field
 *   sends no key at all, and the type stays optional so such a backend still
 *   type-checks. Nothing has been said about this arm's runs, so nothing about
 *   them may be acted on: see {@link countedRunIds} and {@link pruneDeadRunIds}.
 * - `[]` — reported, and **none** of the arm's runs are live (every one was
 *   deleted, or it has never launched any). A current backend always serializes
 *   the field, so an empty array is a positive statement and is trusted as one.
 * - a populated array — those runs, in the arm's launch order.
 *
 * Reading an absent field as "none live" would conflate the first with the
 * second, which is destructive in both directions: a console pointed at an older
 * backend would offer to relaunch every arm from scratch, and would prune every
 * stored run id out of the config on the way to the next write — permanently
 * losing which runs belong to which arm on the strength of a field that was
 * never sent.
 */
export function reportedLiveRunIds(
  result: ComparisonArmResult,
): readonly string[] | undefined {
  return result.liveRunIds;
}

/**
 * The ids an arm is *counted* by: its {@link reportedLiveRunIds} when the backend
 * reported liveness, and otherwise the arm's own recorded `runIds` — the figure
 * the page counted before liveness existed.
 *
 * The fallback errs towards under-launching, never towards double-launching: an
 * unreported arm whose runs were deleted looks full rather than empty, which is
 * the recoverable failure (an operator sees "nothing to trigger"; they do not
 * see their experiment silently re-run).
 *
 * `arm` is the record those ids are read off when nothing was reported, and it
 * defaults to the one the result echoes. A caller holding the **stored config's**
 * arm should pass it instead: the config is the authority on what an arm has
 * launched — it is what the top-up writes back — and the echoed arm is only as
 * complete as the aggregation chose to make it.
 */
export function countedRunIds(
  result: ComparisonArmResult,
  arm: ComparisonArm = result.arm,
): readonly string[] {
  return result.liveRunIds ?? arm.runIds ?? [];
}

/**
 * How many more runs an arm still needs to reach the comparison's `N`, counted
 * off the arm's runs that still exist ({@link countedRunIds}).
 *
 * Neither figure beside it can serve, which is why this counts the live ids in
 * preference to everything else (docs/comparisons/experiments.md, "Triggering
 * the runs"):
 *
 * - `arm.runIds` records every run **ever** launched, so an operator who deleted
 *   an arm's runs leaves it counting dead ids — believing itself full, offering
 *   nothing to trigger, and never topping up again. It is only the fallback for
 *   a backend that reports no liveness at all, where it is the *whole* of what is
 *   known.
 * - `nObserved` counts only the runs whose record has landed, so topping up
 *   against it re-launches every run still in flight each time the page is
 *   opened before they complete.
 */
export function remainingForArm(
  n: number,
  result: ComparisonArmResult,
  arm: ComparisonArm = result.arm,
): number {
  return Math.max(0, n - countedRunIds(result, arm).length);
}

/**
 * Drop from every arm's stored `runIds` the ids that no longer exist, keeping the
 * arm's own launch order.
 *
 * The stored config is what accumulates: an arm relaunched after its runs were
 * deleted would otherwise carry the dead ids forever, and each aggregation would
 * go looking for runs that are not there. So the config is pruned on the way to
 * the next write (docs/comparisons/experiments.md: "The arm's recorded run ids
 * are pruned of runs that no longer exist").
 *
 * Pruning is destructive — the config it returns is PUT back — so it acts only on
 * a positive report that a run is gone. Two arms are therefore left exactly as
 * they are: one with no matching result (nothing was read about its runs at all),
 * and one whose result reports no liveness ({@link reportedLiveRunIds} is
 * `undefined` — an older backend that does not send the field). Neither has been
 * *shown* anything about its runs, and an absent field is not evidence of death.
 */
export function pruneDeadRunIds(
  config: ComparisonConfig,
  results: readonly ComparisonArmResult[],
): ComparisonConfig {
  return {
    ...config,
    arms: config.arms.map((arm) => {
      const result = results.find((r) => r.arm.id === arm.id);
      if (!result) return arm;
      const reported = reportedLiveRunIds(result);
      if (!reported) return arm;
      const live = new Set(reported);
      const kept = (arm.runIds ?? []).filter((id) => live.has(id));
      return kept.length === (arm.runIds?.length ?? 0)
        ? arm
        : { ...arm, runIds: kept };
    }),
  };
}

/** One arm and how many runs it still needs to reach the comparison's `N`. */
export interface ArmTopUp {
  arm: ComparisonArm;
  remaining: number;
}

/**
 * Every arm of a comparison beside the number of runs it still needs, in the
 * config's arm order — what "Trigger missing runs" both counts and loops over, so
 * the button's number and the launches it fires can never disagree.
 *
 * The top-up is measured against the matching result's {@link countedRunIds} —
 * its live ids where the backend reported them, its own recorded ids where it did
 * not. An arm the aggregation reported nothing for at all (no result carries its
 * id — defensive; the backend computes one result per configured arm) falls back
 * to its recorded ids the same way. Both fallbacks lean the same direction: they
 * may under-launch, never double-launch.
 */
export function armTopUps(
  config: ComparisonConfig,
  results: readonly ComparisonArmResult[],
): ArmTopUp[] {
  return config.arms.map((arm) => {
    const result = results.find((r) => r.arm.id === arm.id);
    return {
      arm,
      // The config's own arm, not the result's echo of it: the stored config is
      // what records the launches and what this top-up writes back.
      remaining: result
        ? remainingForArm(config.n, result, arm)
        : Math.max(0, config.n - (arm.runIds?.length ?? 0)),
    };
  });
}

/** The total number of runs a comparison is still short of its `N` per arm. */
export function totalMissingRuns(
  config: ComparisonConfig,
  results: readonly ComparisonArmResult[],
): number {
  return armTopUps(config, results).reduce((sum, t) => sum + t.remaining, 0);
}

/** The controls a launch needs, independent of which are held constant by this
 * particular comparison (a subset of `ComparisonControls`). */
interface LaunchControls {
  caseSlug: string;
  version: string;
  variant: string;
  /** The engine every arm's runs are launched under, absent meaning the
   *  engineless `none` (what a comparison stored before the dimension existed
   *  asked for). */
  engineSlug?: string;
}

/** Whether an arm names a gg configuration (and so launches through gg's own
 *  endpoint) rather than a third-party harness. */
export function isGgArm(arm: ComparisonArm): boolean {
  return Boolean(arm.ggConfigId);
}

/**
 * Build the launch items for a **harness** arm's still-missing runs: `count`
 * copies of the one (case, version, variant, harness, model, orchestrator) tuple
 * the comparison's controls and this arm's own configuration fix. Mirrors
 * `itemsForCells` (`coveragePlan`) and the new-run form's per-combination
 * launch config — the same one-shot orchestrator, since a comparison does not
 * vary it. Returns no items when the arm is missing what a harness arm needs
 * (its harness and its model), which is exactly a gg arm — those launch through
 * `launchGgRun`, not the batch endpoint.
 */
export function harnessArmLaunchItems(
  controls: LaunchControls,
  arm: ComparisonArm,
  count: number,
): LaunchItem[] {
  const harness = arm.harnessSlug;
  const modelId = arm.modelId;
  if (!harness || !modelId || count <= 0) return [];
  // The engine is one of the comparison's held-constant controls, so it rides
  // every launch: an arm run engineless while the comparison declares an engine
  // would be measuring different work from the one it is being compared against.
  const engine = resolveEngineSlug(controls.engineSlug);
  return Array.from({ length: count }, () => ({
    config: {
      testCase: controls.caseSlug,
      version: controls.version,
      variant: controls.variant,
      harness,
      modelId: resolveLaunchModel(harness, OPENROUTER_PROVIDER, modelId),
      orchestrator: DEFAULT_ORCHESTRATOR_SLUG,
      engine,
      maxRuntimeOverride: null,
    },
    track: {
      testCaseSlug: controls.caseSlug,
      testCaseVersion: controls.version,
      variant: controls.variant,
      harnessSlug: harness,
      modelId,
      engine,
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

/**
 * The per-arm distributions a comparison reports on the terms the comparisons
 * statistics page sets for a right-skewed metric: the median with its spread
 * and the mean (docs/comparisons/statistics.md, "Per-arm statistics").
 */
export type ArmMetric = "cost" | "tokens" | "sessionDuration";

/**
 * Each arm's distribution of `metric`, in the arms' order, as the groups a
 * distribution chart draws. An arm with no distribution for the metric (none of
 * its runs reported it, such as runs recorded before the stage durations were
 * measured) is left out rather than drawn at zero.
 */
export function armDistributionGroups(
  arms: readonly ComparisonArmResult[],
  metric: ArmMetric,
  colorForArm: ReadonlyMap<string, string>,
): DistributionGroup[] {
  return arms.flatMap((a) => {
    const summary = a[metric];
    if (!summary) return [];
    return [
      {
        label: a.arm.label,
        color: colorForArm.get(a.arm.id),
        n: summary.n,
        points: [],
        median: summary.median,
        mean: summary.mean,
        min: summary.min,
        max: summary.max,
        q1: summary.q1,
        q3: summary.q3,
        ciLow: summary.ciLow,
        ciHigh: summary.ciHigh,
      },
    ];
  });
}

/** A two-arm comparison's presented ratio on one metric, higher median first. */
export interface PresentedRatio {
  higher: ComparisonArmResult;
  lower: ComparisonArmResult;
  /** `higher`'s median over `lower`'s, so it reads at least one. */
  ratio: number;
}

/**
 * The ratio a two-arm comparison presents for `metric` (docs/comparisons/
 * statistics.md, "Comparing two arms"): the two medians ordered so the ratio
 * reads at least one. Each metric is ordered on its own, since the slower arm
 * is not necessarily the more expensive one. `null` unless there are exactly two
 * arms, both have a distribution for the metric, and the lower median is above
 * zero.
 */
export function presentedRatio(
  arms: readonly ComparisonArmResult[],
  metric: ArmMetric,
): PresentedRatio | null {
  if (arms.length !== 2) return null;
  const [a, b] = arms as [ComparisonArmResult, ComparisonArmResult];
  const aSummary = a[metric];
  const bSummary = b[metric];
  if (!aSummary || !bSummary) return null;
  const [higher, lower] = aSummary.median >= bSummary.median ? [a, b] : [b, a];
  const ratio = medianRatio(higher[metric]!.median, lower[metric]!.median);
  return Number.isNaN(ratio) ? null : { higher, lower, ratio };
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
