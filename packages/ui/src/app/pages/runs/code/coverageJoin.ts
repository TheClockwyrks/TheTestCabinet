// Joining executed coverage onto the tab's per-file spine.
//
// The Code tab already has a structure for "one row per file the model wrote": the
// analysis document's flat `files` list, folded into a tree by `codeTree.ts` and explored
// by `CodeExplorer`. Istanbul's per-file coverage rows are the same rows measured a
// second way, and the record stores them repo-relative and forward-slashed precisely so
// they join to `CodeFileEntry.path` by string equality rather than by path arithmetic.
// So they are joined rather than listed twice: the explorer's child table gains a
// coverage column and a directory's coverage is the sum of what is under it.
//
// Two asymmetries are real and neither is an error, which is why nothing here treats a
// miss as a problem:
//
//   - A file with no coverage row. Istanbul writes a row only for a file it found
//     something to instrument in, and `coverage.include` names `src/**/*.ts` alone, so
//     every asset, config and test file in the tree is legitimately absent. Its coverage
//     is *not measured*, which renders as an em dash and never as a zero.
//   - A coverage row with no file. The static analysis and the coverage run measure the
//     tree at different moments and through different filters, so a row can name a file
//     the analysis floored. Those rows are still shown in the Coverage band's own table —
//     they are part of what was measured — they simply have no tree node to hang on.
//
// Percentages are computed in exactly one place here, because `covered`/`total` and
// istanbul's own `pct` must never be allowed to disagree on screen by a rounding rule.

import type {
  CoverageFile,
  CoverageMetric,
  ToolchainCoverage,
} from "@clockwyrks/run-record";
import type { CodeFileEntry } from "@clockwyrks/run-record/code-analysis";

/** One measured quantity: how many there are, and how many the tests reached. The
 * structural shape both a record `CoverageMetric` and a rolled-up directory total have,
 * so one percentage function serves both. */
export interface CoverageTally {
  covered: number;
  total: number;
  /** Istanbul's own figure, when the record carried one. Absent on a rollup, which is
   * summed rather than reported. */
  pct?: number;
}

/** The four istanbul metrics summed over some set of files, plus how many of those files
 * the reporter actually measured — the difference between "this directory's code is
 * uncovered" and "this directory's code was never measured". */
export interface CoverageRollup {
  measuredFiles: number;
  lines: CoverageTally;
  statements: CoverageTally;
  functions: CoverageTally;
  branches: CoverageTally;
}

/** The four metric keys, in the order every surface presents them: lines first because it
 * is the figure a reader arrives with, branches last because it is the one that most
 * often contradicts the others. */
export const COVERAGE_METRIC_KEYS = [
  "lines",
  "statements",
  "functions",
  "branches",
] as const;

export type CoverageMetricKey = (typeof COVERAGE_METRIC_KEYS)[number];

/** What each metric is called, and what it counts — the label is not enough on its own,
 * because "branches" means something specific to istanbul and a reader who assumes it
 * means `if` statements will misread a low figure. */
export const COVERAGE_METRIC_META: Record<
  CoverageMetricKey,
  { label: string; note: string }
> = {
  lines: { label: "Lines", note: "executable lines" },
  statements: { label: "Statements", note: "a line may hold several" },
  functions: { label: "Functions", note: "including methods and arrows" },
  branches: {
    label: "Branches",
    note: "each arm of an if, ternary, ||, default or case",
  },
};

/**
 * The percentage for one metric, or `null` when there is nothing to take a percentage of.
 *
 * A zero total is an absence, not a zero percent — a file with no branches has not failed
 * to cover its branches — so it returns `null` and every caller renders an em dash.
 * Istanbul's own `pct` wins when it is a finite number, so a stored figure and the report
 * it came from cannot disagree by a rounding rule; a rollup carries no `pct` and falls
 * through to the quotient, which is the same arithmetic istanbul does.
 */
export function coveragePercent(metric: CoverageTally): number | null {
  if (metric.total <= 0) return null;
  if (typeof metric.pct === "number" && Number.isFinite(metric.pct)) {
    return metric.pct;
  }
  return (metric.covered / metric.total) * 100;
}

/** A percentage as it is rendered, with "not measured" as an em dash rather than as a
 * zero — the tab's standing rule, and the one that keeps an unmeasured file from reading
 * as an untested one. */
export function formatCoveragePercent(pct: number | null): string {
  return pct === null ? "—" : `${pct.toFixed(1)}%`;
}

/** The coverage rows keyed by their repo-relative path, so a tree node's files resolve in
 * constant time instead of by scanning the list per row. */
export function indexCoverage(
  coverage: ToolchainCoverage | null | undefined,
): ReadonlyMap<string, CoverageFile> {
  const index = new Map<string, CoverageFile>();
  for (const file of coverage?.files ?? []) index.set(file.path, file);
  return index;
}

function tally(): CoverageTally {
  return { covered: 0, total: 0 };
}

function add(into: CoverageTally, from: CoverageMetric) {
  into.covered += from.covered;
  into.total += from.total;
}

/**
 * Sum the coverage of the files at `fileIndices` — a `CodeTreeNode`'s own subtree.
 *
 * Counts add, which is why the rollup carries `covered`/`total` and not percentages: a
 * directory's line coverage is its files' covered lines over its files' total lines, and
 * averaging its files' percentages would weight a ten-line helper the same as a
 * four-hundred-line system.
 */
export function rollUpCoverage(
  fileIndices: readonly number[],
  files: readonly CodeFileEntry[],
  index: ReadonlyMap<string, CoverageFile>,
): CoverageRollup {
  const rollup: CoverageRollup = {
    measuredFiles: 0,
    lines: tally(),
    statements: tally(),
    functions: tally(),
    branches: tally(),
  };
  for (const at of fileIndices) {
    const path = files[at]?.path;
    const measured = path === undefined ? undefined : index.get(path);
    if (!measured) continue;
    rollup.measuredFiles += 1;
    for (const key of COVERAGE_METRIC_KEYS) add(rollup[key], measured[key]);
  }
  return rollup;
}
