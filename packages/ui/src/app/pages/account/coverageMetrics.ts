import type {
  CoverageCell,
  CoverageMatrix,
} from "@clockwyrks/backend-api/coverage";
import type { RunSummary } from "@clockwyrks/backend-api/snapshot";
import { useEffect, useMemo, useState } from "react";
import type { RatingCounts } from "@clockwyrks/ui";
import { RATINGS, type Rating } from "../../data/ratings";
import { countsAsModelResult } from "../../data/runState";
import { useAuth } from "../../../client/auth";
import { useBackend } from "../../../client/context";
import { comboLabel } from "./comboLabels";

/** One labelled tally in a breakdown, largest first. */
export interface CoverageSlice {
  /** What the slice is of — a model, a combination, or a case name. */
  label: string;
  /** How many of the plan's runs fall in it. */
  count: number;
}

/**
 * What the plan's runs look like, broken down the ways a reviewer steers by.
 *
 * The coverage matrix says how many runs each cell holds; this says what they *were* —
 * which models produced them, which cases they landed on, and how they were rated. The
 * two answer different questions, which is why the dashboard shows both: a plan can be
 * fully covered and still be a plan whose every run is broken.
 */
export interface CoverageRunMetrics {
  /** The plan's runs: the runs its cells hold. */
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
}

/** The empty breakdown, which is what a plan with no runs renders. */
export const NO_COVERAGE_RUN_METRICS: CoverageRunMetrics = {
  total: 0,
  rated: 0,
  reviewed: 0,
  ratings: [],
  byCombination: [],
  byModel: [],
  byCase: [],
  ratingsByCombination: [],
};

/**
 * The plan's runs as one stable string: every cell's run ids, in the matrix's order.
 * It changes exactly when a cell takes in a run, so a matrix refreshed by a poll that
 * changed nothing about the plan's runs does not fetch them again.
 */
export function planRunScope(coverage: CoverageMatrix): string {
  return coverage.cells.map((cell) => cell.runIds.join(",")).join(";");
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
 * Fold a plan's runs into the dashboard's breakdowns.
 *
 * A run is attributed to the cell whose `runIds` hold it, so the corpus is exactly the
 * runs the matrix counts: the first runs to land on each cell, up to its target. A run
 * no cell holds is left out, which is what keeps a run beyond a cell's target, or a
 * run of a combination the plan does not ask for, out of every figure. Attributing by
 * id also names a gg arm by its own bound models, which no field of a run card can.
 *
 * Only the states that count toward a cell are read, so an infrastructure failure or a
 * cancelled run never reaches a breakdown even if a card for one is handed in.
 */
export function summarizeCoverageRuns(
  coverage: CoverageMatrix,
  summaries: readonly RunSummary[],
  testCaseName: (slug: string) => string,
): CoverageRunMetrics {
  const cellOf = new Map<string, CoverageCell>();
  for (const cell of coverage.cells) {
    for (const id of cell.runIds) {
      if (!cellOf.has(id)) cellOf.set(id, cell);
    }
  }

  const byCombination = new Map<string, number>();
  const byModel = new Map<string, number>();
  const byCase = new Map<string, number>();
  const ratings = new Map<Rating, number>();
  const perCombination = new Map<string, Record<Rating, number>>();
  // A card listed twice is one run, counted once.
  const seen = new Set<string>();
  let total = 0;
  let rated = 0;
  let reviewed = 0;

  for (const summary of summaries) {
    const cell = cellOf.get(summary.id);
    if (!cell || seen.has(summary.id)) continue;
    if (!countsAsModelResult(summary.state)) continue;
    seen.add(summary.id);
    total += 1;
    if (summary.reviewCount > 0) reviewed += 1;
    const combination = comboLabel(cell);
    byCombination.set(combination, (byCombination.get(combination) ?? 0) + 1);
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
  };
}

/** What {@link useCoverageRunMetrics} reports while and after it loads. */
export interface CoverageRunMetricsState {
  metrics: CoverageRunMetrics;
  loading: boolean;
  /** Set when the plan's runs could not be read, so the dashboard says so rather than
   *  drawing zeros as though the plan had produced nothing. */
  error: string | null;
}

/**
 * The plan's run breakdowns, read from the plan's own runs
 * (`GET /coverage-plans/{id}/runs`).
 *
 * The backend decides which runs a cell holds, and the matrix lists them; this reads
 * their cards and folds them, so the breakdowns and the counts describe the same runs.
 * They are derived rather than stored, which is what lets a rating that changes under a
 * review show up on the next visit without the plan being touched.
 */
export function useCoverageRunMetrics(
  planId: string,
  coverage: CoverageMatrix | null,
  testCaseName: (slug: string) => string,
): CoverageRunMetricsState {
  const { client: backend } = useBackend();
  const { token } = useAuth();
  const [summaries, setSummaries] = useState<RunSummary[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const scope = useMemo(
    () => (coverage ? planRunScope(coverage) : ""),
    [coverage],
  );
  const empty = coverage
    ? coverage.cells.every((cell) => cell.runIds.length === 0)
    : true;

  useEffect(() => {
    if (empty || !backend?.getCoveragePlanRuns || !token) {
      setSummaries(null);
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    setError(null);
    backend
      .getCoveragePlanRuns(planId, token)
      .then((result) => {
        if (!active) return;
        setSummaries(result.runs);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (!active) return;
        setSummaries(null);
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      });
    return () => {
      active = false;
    };
    // `scope` stands for the plan's runs: a fetch is due exactly when it changes.
  }, [backend, token, planId, scope, empty]);

  const metrics = useMemo(
    () =>
      coverage && summaries
        ? summarizeCoverageRuns(coverage, summaries, testCaseName)
        : NO_COVERAGE_RUN_METRICS,
    [coverage, summaries, testCaseName],
  );

  return { metrics, loading, error };
}
