// Pure helpers behind the comparison detail page's "Trigger missing runs" action
// and its charts — kept free of React/network so the top-up math and the
// tool-call grouping are unit-tested directly (see comparisonMath.test.ts).
import type {
  ArmRunPoint,
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
import { routes } from "../../routes";

/**
 * How many more runs an arm still needs to reach the comparison's `N`: `N` less
 * the runs it holds and its cell's jobs in flight (docs/comparisons/experiments.md,
 * "Triggering the runs"). An arm holds the runs of its coverage cell whoever
 * launched them, so a run launched anywhere else counts here too.
 *
 * An arm the backend reports `unlaunchable` needs nothing: its launches would land
 * in a cell it does not read, so topping it up would launch runs it never counts.
 * A result that reports no held runs at all (a backend older than the field) is
 * read as needing nothing too: an unknown count is never topped up, since the
 * failure in that direction is a relaunch of runs that already exist.
 */
export function remainingForArm(
  n: number,
  result: ComparisonArmResult,
): number {
  if (result.unlaunchable || !Array.isArray(result.runIds)) return 0;
  return Math.max(0, n - result.runIds.length - (result.inFlight ?? 0));
}

/** How many runs the arms are waiting on, across every arm. */
export function runsInFlight(results: readonly ComparisonArmResult[]): number {
  return results.reduce((sum, result) => sum + (result.inFlight ?? 0), 0);
}

/** One arm and how many runs it still needs to reach the comparison's `N`. */
export interface ArmTopUp {
  arm: ComparisonArm;
  remaining: number;
}

/**
 * Every arm of a comparison beside the number of runs it still needs, in the
 * config's arm order — what "Trigger missing runs" both counts and loops over, so
 * the button's number and the launches it fires can never disagree. An arm no
 * result carries (defensive; the backend computes one result per configured arm)
 * needs nothing, on the same terms as {@link remainingForArm}.
 */
export function armTopUps(
  config: ComparisonConfig,
  results: readonly ComparisonArmResult[],
): ArmTopUp[] {
  return config.arms.map((arm) => {
    const result = results.find((r) => r.arm.id === arm.id);
    return { arm, remaining: result ? remainingForArm(config.n, result) : 0 };
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

// The field of a run point that carries each metric's raw value.
const RUN_POINT_FIELD: Readonly<
  Record<ArmMetric, "cost" | "tokens" | "sessionSeconds">
> = {
  cost: "cost",
  tokens: "tokens",
  sessionDuration: "sessionSeconds",
};

/**
 * Each arm's distribution of `metric`, in the arms' order, as the groups a
 * distribution chart draws, with every counted run that reported the metric as
 * a point linking to its run. An arm with no distribution for the metric (none
 * of its runs reported it, such as runs recorded before the stage durations
 * were measured) is left out rather than drawn at zero. A result from a backend
 * that predates `runPoints` draws its boxes without points.
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
        points: (a.runPoints ?? []).flatMap((p: ArmRunPoint) => {
          const value = p[RUN_POINT_FIELD[metric]];
          return value == null
            ? []
            : [{ runId: p.runId, value, href: routes.runDetail(p.runId) }];
        }),
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

/** The kind of work a tool call does, the series the tool-call chart stacks
 * (docs/comparisons/diagnostics.md, "Tool-call kinds"). */
export type ToolKind =
  | "reading"
  | "editing"
  | "shell"
  | "search"
  | "planning"
  | "subagents"
  | "board"
  | "memory"
  | "context"
  | "other";

/** gg's program namespaces for the tools of the same names, so a program's
 * `files.read_file` counts with a tool-calling agent's `read_file`. */
function withNamespace(namespace: string, names: readonly string[]): string[] {
  return [...names, ...names.map((name) => `${namespace}.${name}`)];
}

/**
 * Every tool name the chart recognizes, lowercased as a tally keys it, under the
 * kind of work it does. A name absent from every kind counts as `other`.
 */
export const TOOL_KINDS: Readonly<
  Record<Exclude<ToolKind, "other">, readonly string[]>
> = {
  reading: [
    "read",
    "ls",
    "list",
    "read_file",
    "read_files",
    "list_files",
    "list_dir",
    "tree",
    "read_image",
    "files.read_file",
    "files.list_dir",
    "files.tree",
    "views.open_file",
  ],
  editing: [
    "write",
    "edit",
    "multiedit",
    "notebookedit",
    "apply_patch",
    "editor",
    "write_to_file",
    "replace_in_file",
    "new_rule",
    "text_editor",
    "write_file",
    "edit_file",
    "files.write_file",
    "files.edit_file",
  ],
  shell: [
    "bash",
    "shell",
    "background_process",
    "run_commands",
    "execute_command",
    "command",
    "shell.shell",
  ],
  search: [
    "grep",
    "glob",
    "search",
    "lsp",
    "codesearch",
    "search_files",
    "search_codebase",
    "files.search",
  ],
  planning: [
    "todowrite",
    "todoread",
    "todo",
    ...withNamespace("tasks", [
      "add_task",
      "update_task",
      "complete_task",
      "remove_task",
      "set_blocked_by",
    ]),
  ],
  subagents: [
    "task",
    "agent_manager",
    ...withNamespace("delegation", [
      "spawn_subagent",
      "wait_for_subagents",
      "send_message",
      "transition_state",
      "exec",
      "fork",
    ]),
  ],
  board: withNamespace("board", [
    "create_epic",
    "create_issue",
    "update_issue",
    "remove_epic",
    "remove_issue",
    "set_issue_blocked_by",
    "wait_for_issue",
  ]),
  memory: withNamespace("memories", [
    "create_memory",
    "read_memory",
    "write_memory",
    "update_memory",
    "edit_memory",
    "delete_memory",
    "search_memories",
  ]),
  context: withNamespace("context", [
    "compact",
    "archive_thread",
    "search_archive",
    "evict_file_view",
  ]),
};

// Each kind's one color, the same in every comparison. The six kinds every
// harness does take the categorical palette in order; gg's own three take the
// theme's blue, red and lime from `styles/tokens.css`, and `other` its muted
// grey, so ten kinds stay ten distinguishable hues without cycling the palette.
const TOOL_KIND_COLORS: Readonly<Record<ToolKind, string>> = {
  reading: categoricalColor(0),
  editing: categoricalColor(1),
  shell: categoricalColor(2),
  search: categoricalColor(3),
  planning: categoricalColor(4),
  subagents: categoricalColor(5),
  board: "#60a5fa",
  memory: "#f87171",
  context: "#a3e635",
  other: "#94a3b8",
};

const KIND_ORDER = Object.keys(TOOL_KIND_COLORS) as ToolKind[];

const KIND_OF_TOOL: ReadonlyMap<string, ToolKind> = new Map(
  Object.entries(TOOL_KINDS).flatMap(([kind, names]) =>
    names.map((name) => [name, kind as ToolKind] as const),
  ),
);

/** The kind of work the tool `name` does; `other` for one the chart does not
 * recognize. */
export function toolKind(name: string): ToolKind {
  return KIND_OF_TOOL.get(name.toLowerCase()) ?? "other";
}

/**
 * Turn each arm's raw tool-call tally into the stacked-bar-chart shape
 * (`stackedBarChart`, `packages/ui/src/primitives/plot/charts.ts`): one segment
 * per `(arm, kind)`, plus the `series` list of every kind any arm called, in the
 * fixed kind order and each in its fixed color, so the same work stacks the same
 * way whichever harness did it. Every segment's tooltip lists the arm's kinds,
 * each with the tools counted in it, most-called first. A kind an arm never
 * called gets no segment for that arm.
 */
export function toolCallChartData(arms: readonly ArmToolCalls[]): {
  segments: StackedBarSegment[];
  series: StackedSeries[];
} {
  const byArm = arms.map((arm) => {
    const kinds = new Map<ToolKind, [string, number][]>();
    for (const [name, count] of Object.entries(arm.toolCalls)) {
      if (count <= 0) continue;
      const kind = toolKind(name);
      kinds.set(kind, [...(kinds.get(kind) ?? []), [name, count]]);
    }
    const rows = KIND_ORDER.flatMap((kind) => {
      const tools = kinds.get(kind);
      if (!tools) return [];
      tools.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
      const value = tools.reduce((sum, [, count]) => sum + count, 0);
      return [{ kind, value, tools }];
    });
    return { arm, rows };
  });

  const called = new Set(byArm.flatMap(({ rows }) => rows.map((r) => r.kind)));
  const series: StackedSeries[] = KIND_ORDER.filter((kind) =>
    called.has(kind),
  ).map((kind) => ({ name: kind, color: TOOL_KIND_COLORS[kind] }));

  const segments: StackedBarSegment[] = byArm.flatMap(({ arm, rows }) => {
    const title = [
      arm.armLabel,
      ...rows.map(
        (r) =>
          `${r.kind}: ${r.value} (${r.tools
            .map(([name, count]) => `${name} ${count}`)
            .join(", ")})`,
      ),
    ].join("\n");
    return rows.map((r) => ({
      group: arm.armLabel,
      series: r.kind,
      value: r.value,
      title,
    }));
  });

  return { segments, series };
}
