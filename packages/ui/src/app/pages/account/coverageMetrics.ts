import { useEffect, useMemo, useState } from "react";
import type {
  CoverageCell,
  CoverageMatrix,
} from "@clockwyrks/run-record/coverage";
import type { RunSummary } from "@clockwyrks/run-record/snapshot";
import type { RatingCounts } from "@clockwyrks/ui";
import { RATINGS, type Rating } from "../../data/ratings";
import { useGalleryData } from "../../data/galleryContext";
import type { RunQuery, RunQueryResult } from "../../data/runQuery";
import { comboLabel, ggConfigKey, ggConfigLabel } from "./comboLabels";
import { caseEngine } from "./caseLabels";

// The backend's own per-request ceiling (`MAX_LIMIT` in `api/runs.rs`), which it
// clamps to silently. Asking for more does not get more rows; it only makes the
// requested window a lie.
const PAGE_LIMIT = 200;

// The most runs the breakdowns are computed over. A plan's corpus is bounded by its
// own cases rather than by the cabinet, so this is reached only by a plan spanning a
// heavily-run case; when it is, the figures say so rather than quietly describing a
// slice as if it were the whole.
const MAX_RUNS = 2000;

/** One labelled tally in a breakdown, largest first. */
export interface CoverageSlice {
  /** What the slice is of — a model, a combination, or a case name. */
  label: string;
  /** How many of the plan's runs fall in it. */
  count: number;
}

/**
 * What the plan's recorded runs look like, broken down the ways a reviewer steers by.
 *
 * The coverage matrix says how many runs each cell has; this says what they *were* —
 * which models produced them, which cases they landed on, and how they were rated. The
 * two answer different questions, which is why the dashboard shows both: a plan can be
 * fully covered and still be a plan whose every run is broken.
 */
export interface CoverageRunMetrics {
  /** The runs matched to a cell of this plan. */
  total: number;
  /** How many of them carry a functional rating at all. */
  rated: number;
  /** How many of them carry at least one review. */
  reviewed: number;
  /** Runs per rating tier, in tier order (best first). */
  ratings: { rating: Rating; count: number }[];
  /** Runs per combination (a harness with its model, or a gg configuration). */
  byCombination: CoverageSlice[];
  /** Runs per model — the harness cell's model, and a gg cell's root agent model. */
  byModel: CoverageSlice[];
  /** Runs per test case, by the case's display name. */
  byCase: CoverageSlice[];
  /** Per-combination rating tallies, the shape the stacked ratings chart plots. */
  ratingsByCombination: RatingCounts[];
  /**
   * Whether the corpus was cut short at {@link MAX_RUNS}. The breakdowns then describe
   * the newest runs of the plan's cases rather than every one of them, and the
   * dashboard says so.
   */
  truncated: boolean;
}

/** The empty breakdown, which is what a plan with no recorded runs renders. */
export const NO_COVERAGE_RUN_METRICS: CoverageRunMetrics = {
  total: 0,
  rated: 0,
  reviewed: 0,
  ratings: [],
  byCombination: [],
  byModel: [],
  byCase: [],
  ratingsByCombination: [],
  truncated: false,
};

/**
 * The identity a run summary and a coverage cell are matched on.
 *
 * It is the [cell key](CoverageCell) minus the models a gg configuration binds to its
 * non-root slots: a summary card carries the configuration's id and the root model, and
 * not the rest of the binding. Two arms of one configuration that differ only on a
 * subagent's model therefore share a key here, and a run of either is indistinguishable
 * from a run of the other. Such a group is labelled by the configuration and the number
 * of arms it covers rather than by one arm's models, so the breakdown never attributes
 * one arm's runs to the other by name (see {@link groupLabel}).
 *
 * The configuration is keyed through {@link ggConfigKey} on both sides, because a member
 * may name it as the launcher's `saved:<id>` while a run records the bare id.
 */
export function runMatchKey(summary: RunSummary): string {
  const s = summary.subject;
  return [
    s.testCaseSlug,
    s.testCaseVersion,
    s.variant,
    s.engineSlug || "none",
    s.harnessSlug,
    s.modelId,
    ggConfigKey(s.ggConfigId),
  ].join("::");
}

/** The same identity, read off a coverage cell. */
export function cellMatchKey(cell: CoverageCell): string {
  return [
    cell.slug,
    cell.version,
    cell.variant,
    caseEngine(cell),
    cell.harness,
    cell.model,
    ggConfigKey(cell.ggConfigId),
  ].join("::");
}

/** The distinct case slugs a plan's cells cover — the query's whole scope. */
export function planCaseSlugs(coverage: CoverageMatrix): string[] {
  return [...new Set(coverage.cells.map((cell) => cell.slug))];
}

// Order a tally map largest first, with the label breaking ties so the same data always
// renders in the same order.
function slices(counts: Map<string, number>): CoverageSlice[] {
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

// A zeroed tally across every rating tier — the shape the stacked chart wants, which
// carries the tiers a combination has no runs in so a hover can still report them.
function zeroRatings(): Record<Rating, number> {
  return Object.fromEntries(RATINGS.map((r) => [r, 0])) as Record<
    Rating,
    number
  >;
}

/**
 * What to call the cells sharing one {@link cellMatchKey}.
 *
 * One cell is named as the matrix names it. Several are two or more arms of one gg
 * configuration whose runs a summary card cannot tell apart, so the group is named for
 * the configuration and the number of arms it stands for. Naming it after one arm's
 * bound models would put the other arm's runs under a label that excludes them.
 */
export function groupLabel(group: readonly CoverageCell[]): string {
  const cell = group[0]!;
  if (group.length === 1) return comboLabel(cell);
  return `${ggConfigLabel(cell)} · ${group.length} arms`;
}

/**
 * Fold a plan's recorded runs into the dashboard's breakdowns.
 *
 * Every run is matched to a cell first, so the corpus is exactly the plan's own runs
 * rather than every run of the cases it happens to name. A run that matches no cell is
 * a run of one of these cases on a combination the plan does not ask for, and counting
 * it would describe a plan nobody wrote.
 */
export function summarizeCoverageRuns(
  coverage: CoverageMatrix,
  summaries: readonly RunSummary[],
  testCaseName: (slug: string) => string,
  truncated = false,
): CoverageRunMetrics {
  // Every cell that shares an identity, not the last one to claim it. A run matching an
  // ambiguous identity belongs to one of them and there is no way to say which, so the
  // group is named for what they have in common rather than for whichever cell happened
  // to be stored last.
  const cells = new Map<string, CoverageCell[]>();
  for (const cell of coverage.cells) {
    const key = cellMatchKey(cell);
    const group = cells.get(key);
    if (group) group.push(cell);
    else cells.set(key, [cell]);
  }

  const byCombination = new Map<string, number>();
  const byModel = new Map<string, number>();
  const byCase = new Map<string, number>();
  const ratings = new Map<Rating, number>();
  const perCombination = new Map<string, Record<Rating, number>>();
  let total = 0;
  let rated = 0;
  let reviewed = 0;

  for (const summary of summaries) {
    const group = cells.get(runMatchKey(summary));
    const cell = group?.[0];
    if (!group || !cell) continue;
    total += 1;
    if (summary.reviewCount > 0) reviewed += 1;
    const combination = groupLabel(group);
    byCombination.set(combination, (byCombination.get(combination) ?? 0) + 1);
    // The model is the same across an ambiguous group: it is one of the segments the
    // group is keyed on, which is exactly why the arms could not be told apart.
    byModel.set(cell.model, (byModel.get(cell.model) ?? 0) + 1);
    const name = testCaseName(cell.slug);
    byCase.set(name, (byCase.get(name) ?? 0) + 1);
    const tally = perCombination.get(combination) ?? zeroRatings();
    perCombination.set(combination, tally);
    const rating = summary.rating;
    if (rating) {
      rated += 1;
      ratings.set(rating, (ratings.get(rating) ?? 0) + 1);
      tally[rating] += 1;
    }
  }

  return {
    total,
    rated,
    reviewed,
    // Tier order, not tally order: a rating breakdown reads best-to-worst, and a
    // legend that reordered itself as runs landed could not be read at a glance.
    ratings: RATINGS.filter((r) => (ratings.get(r) ?? 0) > 0).map((rating) => ({
      rating,
      count: ratings.get(rating) ?? 0,
    })),
    byCombination: slices(byCombination),
    byModel: slices(byModel),
    byCase: slices(byCase),
    ratingsByCombination: [...perCombination.entries()]
      .map(([label, counts]) => ({ label, counts }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    truncated,
  };
}

/** A drained corpus and whether the drain stopped at the cap rather than the end. */
export interface PlanRunCorpus {
  summaries: RunSummary[];
  truncated: boolean;
}

/**
 * Drain every recorded run of a plan's cases, newest first, up to {@link MAX_RUNS}.
 *
 * The query is scoped to the plan's case slugs in one listing rather than one listing
 * per case, so a plan naming twenty cases costs the same round trips as a plan naming
 * one. It draws from the `any` slice, because a plan's corpus is what it has *run* —
 * an unpublished run occupies a cell and holds a review buffer slot exactly as a
 * published one does.
 *
 * Exact pinned versions are matched per cell afterwards, so the current-version
 * restriction stays off: a plan deliberately pinned to an older version has every one
 * of its runs on that version, and asking for the current one would return none of them.
 */
export async function drainPlanRunSummaries(
  query: (q: RunQuery) => Promise<RunQueryResult>,
  slugs: string[],
): Promise<PlanRunCorpus> {
  if (slugs.length === 0) return { summaries: [], truncated: false };
  const acc: RunSummary[] = [];
  // Runs land while the drain is walking, and a newest-first listing shifts every row
  // down as they do — so the row on a page boundary comes back on the next page too.
  // De-duplicating by run id is what keeps that from counting one run twice in every
  // figure below.
  const seen = new Set<string>();
  let offset = 0;
  for (;;) {
    const { summaries, total } = await query({
      state: "any",
      testCases: slugs,
      latestVersions: false,
      offset,
      limit: PAGE_LIMIT,
    });
    for (const summary of summaries) {
      if (seen.has(summary.id)) continue;
      seen.add(summary.id);
      acc.push(summary);
    }
    // Advance by what arrived, never by what was asked for: a host free to return
    // fewer rows than requested would otherwise leave a hole in the corpus.
    offset += summaries.length;
    if (summaries.length === 0) return { summaries: acc, truncated: false };
    if (offset >= total) return { summaries: acc, truncated: false };
    if (acc.length >= MAX_RUNS) return { summaries: acc, truncated: true };
  }
}

/** What {@link useCoverageRunMetrics} reports while and after it loads. */
export interface CoverageRunMetricsState {
  metrics: CoverageRunMetrics;
  loading: boolean;
  /** Set when the corpus could not be read, so the dashboard says so rather than
   *  drawing zeros as though the plan had produced nothing. */
  error: string | null;
}

/**
 * The plan's run breakdowns, read from the cabinet's own run listing.
 *
 * The matrix the dashboard is built on counts runs per cell and nothing else, so the
 * breakdowns are computed here from the summary cards of the plan's cases. They are
 * derived rather than stored, which is what lets a rating that changes under a review
 * show up on the next visit without the plan being touched.
 */
export function useCoverageRunMetrics(
  coverage: CoverageMatrix | null,
  testCaseName: (slug: string) => string,
): CoverageRunMetricsState {
  const { queryRunSummaries } = useGalleryData();
  const [corpus, setCorpus] = useState<PlanRunCorpus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // The scope as a stable string, so a matrix refreshed by a top-up (new counts, the
  // same cases) does not re-drain the corpus on every poll.
  const scope = useMemo(
    () => (coverage ? planCaseSlugs(coverage).sort().join(",") : ""),
    [coverage],
  );

  useEffect(() => {
    if (!scope) {
      setCorpus(null);
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    setError(null);
    drainPlanRunSummaries(queryRunSummaries, scope.split(","))
      .then((result) => {
        if (!active) return;
        setCorpus(result);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (!active) return;
        setCorpus(null);
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [queryRunSummaries, scope]);

  const metrics = useMemo(
    () =>
      coverage && corpus
        ? summarizeCoverageRuns(
            coverage,
            corpus.summaries,
            testCaseName,
            corpus.truncated,
          )
        : NO_COVERAGE_RUN_METRICS,
    [coverage, corpus, testCaseName],
  );

  return { metrics, loading, error };
}
