// The review-score leaderboard fold, shared by the case-detail Leaderboard tab
// (one case + variant, ranked by mean points) and the home page's per-group
// boards (a test-case group's member cases in one fold, ranked by mean score
// FRACTION — cross-case point totals differ, so raw points are not comparable
// there). The fold owns the row identity and the run-level exclusions; WHICH
// runs are in scope (case, variant, version scope, engine scope) is the
// caller's filter, applied before folding.

import type { RunSummary } from "@test-cabinet/run-record/snapshot";
import { canonicalModelId } from "../../modelId";
import { isGgRun } from "./runLinks";
import {
  asGrade,
  AESTHETIC_RATINGS,
  GRADE_LEVELS,
  overallGradeOf,
  RATINGS,
  scoreChecklist,
  worstRating,
  type AestheticRating,
  type GradeStatus,
  type ParsedWriteup,
  type Rating,
} from "./ratings";
import type { VariantSummary } from "./testCases";
import { totalTokens } from "../format";

// The `Map` key separator for a fold key's parts: NUL, the one character none
// of a harness slug, a model id, or an engine slug can contain, so no two legal
// keys can collide on it. Spelled as an escape rather than written as a byte,
// which would make the line unsearchable.
const PAIR_SEP = "\u0000";

/** One run's board contribution, resolved by {@link resolveRunScore}. */
export interface ScoredRun {
  earned: number;
  total: number;
  rating: Rating | null;
  grade: GradeStatus | null;
  aesthetic: AestheticRating | null;
}

// One `(harness, model[, engine])` pair's scored runs, folded but not yet
// aggregated: the per-run lists a board derives its columns from. The case page
// takes extremes/means of `earned` (every run shares that variant's `total`);
// the home page's cross-case boards rank on the mean of `fractions`, since two
// cases' point totals are not comparable. The board splits by harness as well
// as model — the same model under two harnesses is two rows, never one merged
// rank (see docs/comparisons/metrics-split) — and, when `keyEngine` is set, by
// the run's engine too: runs under different engines measure different work, so
// they are never folded into one row.
export interface LeaderboardFoldEntry {
  /** The composite `(harness, model[, engine])` key; also a stable row key. */
  rowKey: string;
  /** The canonical (harness-aware) model id the row folds on. */
  modelId: string;
  /** Display name, resolved through the caller's resolver from the first
   * contributing run's raw model id (falls back to the canonical id). */
  modelName: string;
  /** The harness that produced this pair's runs. */
  harnessSlug: string;
  /** The run engine this row is keyed on (`none` for the engineless run), or
   * null when the fold was not keyed by engine. */
  engineSlug: string | null;
  /** The points available — uniform across one variant's runs (the case
   * boards' denominator); on a cross-case fold, the last contributing run's. */
  total: number;
  /** Points earned, one entry per contributing run. */
  earned: number[];
  /** Score fraction (earned/total) per contributing run — the cross-case
   * ranking figure. A run whose total is 0 contributes a 0 fraction. */
  fractions: number[];
  /** The overall functional ratings of the runs that carried one. */
  ratings: Rating[];
  /** The overall aesthetic ratings of the runs that carried one. */
  aesthetics: AestheticRating[];
  /** The whole-game overall grades of the runs that carried one (game jams). */
  grades: GradeStatus[];
  /** The comparable costs of the runs whose cost is known. */
  costs: number[];
  /** The token totals of the runs that reported any. */
  tokens: number[];
  /** The most recent contributing run's start time, for recency tie-breaks. */
  latestStartedAt: string;
}

export interface LeaderboardFoldOptions {
  /**
   * The variant whose checklist scores a run that carries no enriched summary
   * score — a console's produced (local) legacy run, scored from its previewed
   * writeup via `findReview`. Omitted on a cross-case fold (the home page),
   * where only summary-scored runs rank; a score-less run then drops, exactly
   * as it does on the case board.
   */
  variant?: VariantSummary;
  /** The writeup lookup backing the {@link variant} fallback. */
  findReview?: (
    runId: string,
    override?: Readonly<Record<string, string>>,
  ) => ParsedWriteup | undefined;
  /** Local writeup previews, passed through to `findReview`. */
  localWriteups?: Readonly<Record<string, string>>;
  /** Split rows by the run's engine (the case board's widened-scope view, and
   * every cross-case fold). Off, every run is assumed pre-filtered to one
   * engine and the rows carry no engine identity. */
  keyEngine?: boolean;
  /** Resolve a display name from a RAW model id + harness (the catalog's
   * harness-aware lookup). Absent, rows are named by the canonical id. */
  resolveModelName?: (modelId: string, harnessSlug: string) => string | null;
}

/**
 * Fold scored runs into per-`(harness, model[, engine])` rows. Three run-level
 * exclusions, identical on every board:
 *
 * - only a completed run can be ranked — a failed run produced no result and is
 *   never reviewable, so it carries no score;
 * - gg runs are excluded — a gg run's agents may span several models, so it has
 *   no single model to rank on a per-model board (see
 *   docs/comparisons/metrics-split);
 * - a run {@link resolveRunScore} cannot score drops off the board.
 */
export function foldLeaderboardEntries(
  summaries: readonly RunSummary[],
  options: LeaderboardFoldOptions = {},
): LeaderboardFoldEntry[] {
  const { variant, findReview, localWriteups, keyEngine, resolveModelName } =
    options;
  const entries = new Map<string, LeaderboardFoldEntry>();
  for (const run of summaries) {
    if (run.state !== "completed") continue;
    if (isGgRun(run.subject.harnessSlug)) continue;
    // The run's earned/total points and overall rating, read from whichever
    // source this host populated: a published run arrives as a summary card the
    // backend/snapshot already enriched with its aggregate score + rating,
    // while a local, not-yet-published console run is scored from its preview
    // writeup when the caller supplied the variant's checklist. Null drops the
    // run off the board.
    const scored =
      variant && findReview
        ? resolveRunScore(run, variant, findReview, localWriteups ?? {})
        : summaryScore(run);
    if (!scored) continue;
    const { earned, total, rating, grade, aesthetic } = scored;
    const harnessSlug = run.subject.harnessSlug;
    // Canonicalized (harness-aware) so an `openrouter/`-prefixed or `:free`-tagged
    // run and its base form fold into one model, not two rows. A summary from
    // before engine selection existed reads as the engineless "none".
    const modelId = canonicalModelId(run.subject.modelId, harnessSlug);
    const runEngine = run.subject.engineSlug ?? "none";
    const key = keyEngine
      ? `${harnessSlug}${PAIR_SEP}${modelId}${PAIR_SEP}${runEngine}`
      : `${harnessSlug}${PAIR_SEP}${modelId}`;
    // Null when the run's comparable cost / token total is unknown; such runs
    // are excluded from the respective list rather than folded in as zero.
    const cost = run.metrics.cost.comparable;
    const tokens = totalTokens(run.metrics);

    let entry = entries.get(key);
    if (!entry) {
      entry = {
        rowKey: key,
        modelId,
        modelName:
          resolveModelName?.(run.subject.modelId, harnessSlug) ?? modelId,
        harnessSlug,
        engineSlug: keyEngine ? runEngine : null,
        total,
        earned: [],
        fractions: [],
        ratings: [],
        aesthetics: [],
        grades: [],
        costs: [],
        tokens: [],
        latestStartedAt: run.startedAt,
      };
      entries.set(key, entry);
    }
    entry.total = total;
    entry.earned.push(earned);
    entry.fractions.push(total > 0 ? earned / total : 0);
    if (rating) entry.ratings.push(rating);
    if (aesthetic) entry.aesthetics.push(aesthetic);
    if (grade) entry.grades.push(grade);
    if (cost !== null) entry.costs.push(cost);
    if (tokens !== null) entry.tokens.push(tokens);
    if (run.startedAt > entry.latestStartedAt) {
      entry.latestStartedAt = run.startedAt;
    }
  }
  return [...entries.values()];
}

// The enriched-summary score branch of {@link resolveRunScore}, shared with the
// variant-less fold path: a published (or store-scored produced) run's card
// carries its aggregate `score`, `rating`, and `aesthetic` already.
function summaryScore(run: RunSummary): ScoredRun | null {
  if (!run.score) return null;
  return {
    earned: run.score.earned,
    total: run.score.total,
    rating: run.rating,
    // A jam's summary carries its whole-game overall grade here; a non-jam's is
    // absent/null.
    grade: asGrade(run.score.overallGrade),
    aesthetic: run.aesthetic ?? null,
  };
}

// Resolve one run's board contribution — the points it earned, the points
// available, its overall functional rating, and its overall aesthetic rating —
// from whichever source this host populated.
//
// A published run reaches the leaderboard as a summary card the backend (console)
// or snapshot builder (static site) already enriched with its aggregate `score`
// (mean earned weight over the shared total) and `rating`; since the summary/detail
// split, the console no longer loads a published run's full record eagerly, so its
// per-review checklist is not on hand to re-derive these — the enriched fields are.
// A console's own produced (local, not-yet-published) run carries the store's
// score too (`toRunSummary` lifts it), so a validator-rated run this console
// produced ranks the moment it completes, reviewed or not: its points and
// functional rating are the validators' and never depend on a review. A produced
// legacy run without one falls back to the locally-previewed writeup that only
// such runs have and scores it against the variant's checklist. Returns null when
// the run has neither, so it drops off the board.
//
// The aesthetic rating rides along from the summary (the aggregate across the
// run's reviews) or, on the writeup fallback, from the writeup's own run-wide
// tier; it never decides whether a run ranks.
export function resolveRunScore(
  run: RunSummary,
  variant: VariantSummary,
  findReview: (
    runId: string,
    override?: Readonly<Record<string, string>>,
  ) => ParsedWriteup | undefined,
  localWriteups: Readonly<Record<string, string>>,
): ScoredRun | null {
  const fromSummary = summaryScore(run);
  if (fromSummary) return fromSummary;
  const review = findReview(run.id, localWriteups);
  if (!review) return null;
  // A game jam grades its categories (and a whole-game overall mark) rather than
  // rating scoring domains, so it carries no per-domain ratings — its review is
  // scored off the checklist and badged by the overall grade. Detect it from the
  // variant's items so a local, not-yet-published jam run still ranks.
  const graded = variant.reviewItems.some((item) => item.graded);
  if (graded) {
    const grade = overallGradeOf(review.checklist);
    // A jam review with neither an overall grade nor any category verdict has
    // nothing to contribute — drop it, mirroring the unrated case below.
    if (!grade && review.checklist.length === 0) return null;
    const { earned, total } = scoreChecklist(
      variant.reviewItems,
      review.checklist,
    );
    return { earned, total, rating: null, grade, aesthetic: null };
  }
  if (review.ratings.length === 0) return null;
  const { earned, total } = scoreChecklist(
    variant.reviewItems,
    review.checklist,
  );
  return {
    earned,
    total,
    rating: worstRating(review.ratings.map((r) => r.rating)),
    grade: null,
    aesthetic: review.aesthetic,
  };
}

/** The best (highest) rating among `ratings`, or null when empty — the mirror
 * of `worstRating`, used for a board's Best Rating column. */
export function bestRating(ratings: readonly Rating[]): Rating | null {
  let best: Rating | null = null;
  let bestRank = RATINGS.length;
  for (const rating of ratings) {
    const rank = RATINGS.indexOf(rating);
    if (rank < bestRank) {
      bestRank = rank;
      best = rating;
    }
  }
  return best;
}

/** The best (highest) aesthetic rating among `ratings`, or null when empty —
 * the mirror of `worstAestheticRating`. */
export function bestAestheticRating(
  ratings: readonly AestheticRating[],
): AestheticRating | null {
  let best: AestheticRating | null = null;
  let bestRank = AESTHETIC_RATINGS.length;
  for (const rating of ratings) {
    const rank = AESTHETIC_RATINGS.indexOf(rating);
    if (rank < bestRank) {
      bestRank = rank;
      best = rating;
    }
  }
  return best;
}

/** The best (highest-point) graded tier among `grades`, or null when empty —
 * the mirror of `worstGrade`, used on a game jam's board. */
export function bestGrade(grades: readonly GradeStatus[]): GradeStatus | null {
  let best: GradeStatus | null = null;
  let bestRank = -1;
  for (const grade of grades) {
    const rank = GRADE_LEVELS.indexOf(grade);
    if (rank > bestRank) {
      bestRank = rank;
      best = grade;
    }
  }
  return best;
}

/** The mean of `values`, or null when there are none — so a metric with no
 * contributing run reads as "—" rather than a misleading 0. */
export function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}
