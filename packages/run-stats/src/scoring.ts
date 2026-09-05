// The scoring and aggregation rules for a reviewed run: the rating scale, the
// graded (game-jam) scale, checklist scoring, and the aggregations that fold a
// run's several reviews into one figure.
//
// This module is the framework-free half of what used to live in
// `@clockwyrks/ui`'s `ratings` module. The rules are shared by everything that
// has to agree on a number — the consoles, the static gallery, the public read
// edge, and anything that freezes a figure and later recomputes it — so they
// cannot live in a React package. The *display* metadata that went with them
// (labels, emoji, prose descriptions) is presentation and stays in the UI, which
// re-exports this module so its existing consumers are unaffected.
//
// Every function here mirrors a counterpart in the Rust core
// (`crates/core/src/review.rs`); the mirrors are named per function and must be
// kept in lockstep, since the backend and these clients score the same runs.

import type { DebugScriptResult } from "@clockwyrks/run-record";
import type {
  AestheticRating,
  DomainAesthetic,
  DomainRating,
  FailureCap,
  Rating,
  ReviewVerdict,
  VerdictStatus,
} from "@clockwyrks/run-record/review";

/** Every rating, ordered best to worst. */
export const RATINGS: readonly Rating[] = [
  "flawless",
  "great",
  "passable",
  "scuffed",
  "broken",
];

/** Narrowing type guard for {@link Rating}. */
export function isRating(value: string): value is Rating {
  return (RATINGS as readonly string[]).includes(value);
}

/**
 * The worst (lowest) rating among `ratings`, or null when empty. A run's overall
 * rating is the worst across its domains — a flawless mode cannot mask a broken
 * one. Mirrors `Rating::worst` in the Rust core.
 */
export function worstRating(ratings: readonly Rating[]): Rating | null {
  let worst: Rating | null = null;
  let worstRank = -1;
  for (const rating of ratings) {
    const rank = RATINGS.indexOf(rating);
    if (rank > worstRank) {
      worstRank = rank;
      worst = rating;
    }
  }
  return worst;
}

/**
 * Every **aesthetic** rating, ordered best to worst — the second rating channel,
 * separate from the functional {@link Rating}. A reviewer supplies one tier
 * **run-wide** — for the whole build, not per scoring domain — on a
 * validator-rated run only; a legacy run never carries one. `amazing` is the
 * normal maximum and `legendary` is exceptional and reserved. Mirrors
 * `AestheticRating::ALL` in the Rust core.
 */
export const AESTHETIC_RATINGS: readonly AestheticRating[] = [
  "legendary",
  "amazing",
  "good",
  "okay",
  "slop",
];

/** Narrowing type guard for {@link AestheticRating}. */
export function isAestheticRating(value: string): value is AestheticRating {
  return (AESTHETIC_RATINGS as readonly string[]).includes(value);
}

/**
 * The worst (lowest) aesthetic rating among `ratings`, or null when empty. Like
 * {@link worstRating}, a run's overall aesthetic rating is the worst across its
 * reviews' run-wide tiers. Mirrors `AestheticRating::worst` in the Rust core.
 */
export function worstAestheticRating(
  ratings: readonly AestheticRating[],
): AestheticRating | null {
  let worst: AestheticRating | null = null;
  let worstRank = -1;
  for (const rating of ratings) {
    const rank = AESTHETIC_RATINGS.indexOf(rating);
    if (rank > worstRank) {
      worstRank = rank;
      worst = rating;
    }
  }
  return worst;
}

/**
 * The aggregate **aesthetic** rating across a run's reviews: the worst (lowest)
 * run-wide tier any reviewer gave, or null when none carry one (a legacy run, or
 * a validator-rated run nobody has reviewed yet). Each entry is one review's
 * run-wide tier — a legacy stored row's per-domain entries collapse to their
 * worst tier before reaching here (see {@link reviewAesthetic}). The same rule
 * as {@link aggregateRating}, on the aesthetic channel. Mirrors
 * `aggregate_aesthetic` in the Rust core.
 */
export function aggregateAestheticRating(
  reviews: readonly (AestheticRating | null | undefined)[],
): AestheticRating | null {
  return worstAestheticRating(
    reviews.filter((tier): tier is AestheticRating => tier != null),
  );
}

/**
 * A review's run-wide aesthetic tier, read compatibly across contract vintages:
 * the `aesthetic` field when the review carries one, else the **worst** tier
 * across a legacy row's per-domain `aesthetics` entries (which equals the old
 * per-domain aggregation, so a legacy review's displayed value does not change),
 * else null (a legacy run's review, which has no aesthetic channel). The read
 * helper behind {@link aggregateAestheticRating}'s inputs; mirrors how the Rust
 * backend resolves a stored row's tier (`aesthetic ?? worst(aesthetics)`).
 */
export function reviewAesthetic(review: {
  aesthetic?: AestheticRating | null;
  aesthetics?: readonly DomainAesthetic[];
}): AestheticRating | null {
  return (
    review.aesthetic ??
    worstAestheticRating((review.aesthetics ?? []).map((a) => a.rating))
  );
}

/**
 * Every failure cap, from the most to the least severe. A review item on a
 * validator-rated case version declares one: the highest functional rating its
 * domains may reach while the item's validator fails. `flawless` is never a cap —
 * a failure always costs something. Mirrors `FailureCap::ALL` in the Rust core.
 */
export const FAILURE_CAPS: readonly FailureCap[] = [
  "broken",
  "scuffed",
  "passable",
  "great",
];

/** Narrowing type guard for {@link FailureCap}. */
export function isFailureCap(value: string): value is FailureCap {
  return (FAILURE_CAPS as readonly string[]).includes(value);
}

/**
 * The functional {@link Rating} each {@link FailureCap} bounds a domain to while
 * its item fails. Mirrors `FailureCap::rating` in the Rust core.
 */
export const FAILURE_CAP_RATING: Record<FailureCap, Rating> = {
  broken: "broken",
  scuffed: "scuffed",
  passable: "passable",
  great: "great",
};

/**
 * One of the five **graded** tiers a game jam scores on (as opposed to the binary
 * pass/fail). A game jam's review categories and its whole-game overall mark are
 * always one of these. A subtype of {@link VerdictStatus}.
 */
export type GradeStatus =
  | "broken"
  | "poor"
  | "neutral"
  | "great"
  | "incredible";

/**
 * The five graded tiers, ordered worst to best. A game jam's category grades and
 * its whole-game overall grade are always one of these. Mirrors
 * `VerdictStatus::GRADES` in the Rust core.
 */
export const GRADE_LEVELS: GradeStatus[] = [
  "broken",
  "poor",
  "neutral",
  "great",
  "incredible",
];

/** The most points a single graded tier is worth (an `incredible`). A graded
 * item's available points are this times its weight. Mirrors
 * `VerdictStatus::MAX_GRADE_POINTS` in the Rust core. */
export const GRADE_MAX_POINTS = 10;

/**
 * The points each graded tier is worth, before the item's weight. Mirrors
 * `VerdictStatus::grade_points` in the Rust core; keep the two in lockstep. The
 * UI's `GRADE_META` reads its `points` from here rather than restating them, so
 * the scale has one source of truth even though its emoji and labels are
 * presentation.
 */
export const GRADE_POINTS: Record<GradeStatus, number> = {
  broken: 0,
  poor: 2,
  neutral: 5,
  great: 8,
  incredible: 10,
};

/**
 * The reserved checklist id carrying a game jam reviewer's whole-game **overall**
 * grade — a graded {@link VerdictStatus} the reviewer supplies directly (never
 * derived from the category grades). It rides the ordinary checklist under this id,
 * is excluded from the point score (it is not a declared item), and becomes the
 * run's rating badge on a jam. Mirrors `OVERALL_VERDICT_ID` in the Rust core.
 */
export const OVERALL_VERDICT_ID = "overall";

/** Narrowing type guard for {@link GradeStatus} — one of the five graded tiers. */
export function isGrade(value: string): value is GradeStatus {
  return (GRADE_LEVELS as readonly string[]).includes(value);
}

/**
 * The points one of the five graded tiers is worth (0/2/5/8/10), or `undefined`
 * for the binary `pass`/`fail`. Mirrors `VerdictStatus::grade_points` in the Rust
 * core.
 */
export function gradePoints(status: VerdictStatus): number | undefined {
  return isGrade(status) ? GRADE_POINTS[status] : undefined;
}

/**
 * The worst (lowest-point) graded tier among `grades`, or null when empty or none
 * are graded tiers (binary pass/fail are skipped). A run's overall game grade is
 * the worst any reviewer gave, mirroring how a run's overall rating is the worst
 * domain. Mirrors `VerdictStatus::worst_grade` in the Rust core.
 */
export function worstGrade(
  grades: readonly VerdictStatus[],
): GradeStatus | null {
  let worst: GradeStatus | null = null;
  let worstPoints = Infinity;
  for (const grade of grades) {
    if (!isGrade(grade)) continue;
    const points = GRADE_POINTS[grade];
    if (points < worstPoints) {
      worstPoints = points;
      worst = grade;
    }
  }
  return worst;
}

/** Narrowing type guard for {@link VerdictStatus} — the binary pass/fail plus the
 * five graded tiers. */
export function isVerdictStatus(value: string): value is VerdictStatus {
  return value === "pass" || value === "fail" || isGrade(value);
}

/** A run's numeric score: the point weight earned over the total available. */
export interface Score {
  /** The weight of the items the reviewer marked `pass`. */
  earned: number;
  /** The total weight of every declared item — the points available. */
  total: number;
}

/** A sub-item of a {@link WeightedItem} (a review item under a category). */
export interface WeightedSubItem {
  id: string;
  /** On a validator-rated version, the highest functional rating this point's
   * `domains` may reach while its validator fails; absent on a legacy version.
   * Mirrors `SubReviewItem::failure_cap` in the Rust core. */
  failureCap?: FailureCap | null;
  /** On a validator-rated version, the scoring domain ids a failure of this point
   * lowers; absent/empty on a legacy version. Mirrors `SubReviewItem::domains`. */
  domains?: readonly string[];
  /** How many points this sub-item is worth. Defaults to 1 when omitted (a
   * legacy name-only sub-item, or a categories item that left `weight` implicit);
   * the parent category's weight is the sum of its sub-items' weights. */
  weight?: number;
  /** Whether this sub-item contributes to the score. `true`/omitted for every
   * declared sub-item; `false` only on the effective checklist when an erratum's
   * `excludeFromScore` links its composite verdict id (see {@link applyScoreExclusions}).
   * A non-scoring point is still checked and shown — {@link scoreChecklist} just
   * skips it. Mirrors `SubReviewItem::scored` in the Rust core. */
  scored?: boolean;
}

/** The minimal shape {@link scoreChecklist} needs from a declared review item. */
export interface WeightedItem {
  id: string;
  weight: number;
  /** The failure cap of a whole-item point on a validator-rated version (a
   * category carries none — its points do). Mirrors `ReviewItem::failure_cap`. */
  failureCap?: FailureCap | null;
  /** The domains a failure of a whole-item point lowers on a validator-rated
   * version. Mirrors `ReviewItem::domains`. */
  domains?: readonly string[];
  /** Whether the item is graded on the five-level scale (a game-jam category)
   * rather than pass/fail. When true it is worth `weight × 10` points and earns the
   * graded tier's points times its weight; the two scales never mix within a case. */
  graded?: boolean;
  /** Whether this item contributes to the score. `true`/omitted for every declared
   * item; `false` only on the effective checklist when an erratum's `excludeFromScore`
   * links its verdict id (see {@link applyScoreExclusions}). A non-scoring item is
   * still checked and shown. Mirrors `ReviewItem::scored` in the Rust core. */
  scored?: boolean;
  /** The item's name-only sub-items, when it is graded per sub-item rather than
   * as a whole. */
  subItems?: readonly WeightedSubItem[];
}

/**
 * The verdict id a reviewer records for one of an item's sub-items: the
 * composite `<item id>.<sub-item id>`. A sub-item's verdict is an ordinary
 * {@link ReviewVerdict} whose id names the point within the item. Mirrors
 * `ReviewItem::sub_item_verdict_id` in the Rust core.
 */
export function subItemVerdictId(itemId: string, subItemId: string): string {
  return `${itemId}.${subItemId}`;
}

/**
 * The verdict ids a reviewer must record for `item`: the item's own id when it
 * is graded as a whole, or one composite id per sub-item when it declares
 * `subItems`. This is the set of ids that must appear in a review's checklist for
 * the item to be fully addressed. Mirrors `ReviewItem::verdict_ids` in the Rust
 * core.
 */
export function verdictIdsForItem(item: {
  id: string;
  subItems?: readonly WeightedSubItem[];
}): string[] {
  if (!item.subItems || item.subItems.length === 0) return [item.id];
  return item.subItems.map((sub) => subItemVerdictId(item.id, sub.id));
}

/**
 * Combine a case's common review items with a variant's own into the effective
 * list a run of that variant is reviewed and scored against, merging by id: a
 * variant item whose id matches a common item folds its `subItems` into that
 * common item (and adds its weight) rather than appending a second same-id group,
 * so a variant can extend a common **category** (in the `[review] format = 2`
 * grammar a category is a review item and its items are `subItems`). A variant
 * item with a fresh id is appended, preserving "common first, then the variant's
 * own". Because resolution forbids two items resolving to the same verdict id, a
 * merge only ever unions disjoint sub-items under a shared category id. Mirrors
 * `merge_review_items` in the Rust core (crates/core/src/test_case.rs).
 */
export function mergeReviewItems<
  T extends {
    id: string;
    weight: number;
    subItems?: readonly { id: string }[];
  },
>(common: readonly T[], variant: readonly T[]): T[] {
  const result: T[] = common.map((item) => ({ ...item }));
  for (const item of variant) {
    const existing = result.find((candidate) => candidate.id === item.id);
    if (existing) {
      existing.weight += item.weight;
      existing.subItems = [
        ...(existing.subItems ?? []),
        ...(item.subItems ?? []),
      ];
    } else {
      result.push({ ...item });
    }
  }
  return result;
}

/**
 * Restrict an effective checklist (the output of {@link mergeReviewItems}) to the
 * points a run built on `engine` actually carries. A point whose validator names a
 * set of engines is only decided on those: a whole item its validator does not
 * cover is dropped, a sub-item its validator does not cover is dropped from its
 * parent, and an item that declared sub-items and has none left is dropped with
 * them. A point with no validator, or one whose validator names no engines, is
 * carried on every engine. Non-mutating. Mirrors
 * `TestCaseVersion::review_items_for_engine` in the Rust core
 * (crates/core/src/test_case.rs).
 */
export function reviewItemsForEngine<
  T extends {
    validation?: EngineScopedValidation | null;
    subItems?: readonly { validation?: EngineScopedValidation | null }[];
  },
>(items: readonly T[], engine: string): T[] {
  const covers = (validation: EngineScopedValidation | null | undefined) =>
    !validation ||
    !validation.engines ||
    validation.engines.length === 0 ||
    validation.engines.includes(engine);
  const kept: T[] = [];
  for (const item of items) {
    if (!covers(item.validation)) continue;
    if (!item.subItems || item.subItems.length === 0) {
      kept.push({ ...item });
      continue;
    }
    const subItems = item.subItems.filter((sub) => covers(sub.validation));
    if (subItems.length === 0) continue;
    kept.push({ ...item, subItems });
  }
  return kept;
}

/** The engine scoping of a point's validator, as {@link reviewItemsForEngine}
 * reads it: the engine slugs the validator decides its point on, empty or absent
 * for a validator active on every engine the case supports. */
export interface EngineScopedValidation {
  engines?: readonly string[];
}

/**
 * The review verdict ids excluded from scoring for a run of `variant`: the `review`
 * link of every erratum in scope (case-wide, or scoped to this variant) that sets
 * `excludeFromScore`. Each id names a point still checked and shown for the version
 * but no longer contributing to the score. Mirrors
 * `TestCaseVersion::excluded_verdict_ids` in the Rust core.
 */
export function excludedVerdictIds(
  errata: readonly {
    excludeFromScore?: boolean;
    review?: string | null;
    variant?: string | null;
  }[],
  variant: string,
): Set<string> {
  const excluded = new Set<string>();
  for (const erratum of errata) {
    if (!erratum.excludeFromScore) continue;
    if (erratum.variant != null && erratum.variant !== variant) continue;
    if (erratum.review) excluded.add(erratum.review);
  }
  return excluded;
}

/**
 * Return a copy of an effective checklist (the output of {@link mergeReviewItems})
 * with the `scored` flag cleared on every point named in `excluded`. An id that
 * names a whole item clears that item — and, if it is a category, every one of its
 * sub-items; a composite `<item>.<sub>` id clears only that sub-item. Ids matching
 * no point are ignored. Non-mutating (it clones the affected items/sub-items) so the
 * shared review-item objects the caller holds are left untouched. Mirrors
 * `apply_score_exclusions` in the Rust core.
 */
export function applyScoreExclusions<
  T extends {
    id: string;
    scored?: boolean;
    subItems?: readonly { id: string; scored?: boolean }[];
  },
>(items: readonly T[], excluded: ReadonlySet<string>): T[] {
  if (excluded.size === 0) return items.map((item) => ({ ...item }));
  return items.map((item) => {
    const itemExcluded = excluded.has(item.id);
    const subItems = item.subItems?.map((sub) => {
      const subExcluded =
        itemExcluded || excluded.has(subItemVerdictId(item.id, sub.id));
      return subExcluded ? { ...sub, scored: false } : { ...sub };
    });
    return {
      ...item,
      scored: itemExcluded ? false : item.scored,
      ...(subItems ? { subItems } : {}),
    };
  });
}

/**
 * Score a run by combining the case's declared `items` (which carry the point
 * weights) with the reviewer's `verdicts`. An item graded as a whole earns its
 * weight when marked `pass` and none when marked `fail`. An item with sub-items
 * (a category of review items) earns the weight of each sub-item that passed —
 * the category's own weight is the sum of its sub-items' weights (each defaulting
 * to 1). A `graded` item (a game-jam category) instead is worth `weight × 10`
 * points and earns the graded tier's points times its weight (0 when unjudged).
 * The total is the sum of every item's available points. Mirrors
 * `score_checklist` in the Rust core.
 */
export function scoreChecklist(
  items: readonly WeightedItem[],
  verdicts: readonly ReviewVerdict[],
): Score {
  const statusOf = (id: string) => verdicts.find((v) => v.id === id)?.status;
  const passed = (id: string) => statusOf(id) === "pass";
  let earned = 0;
  let total = 0;
  for (const item of items) {
    // A whole item excluded from scoring for the version (an erratum's
    // `excludeFromScore`) counts toward neither side of the ratio — it is still
    // checked and shown, just not scored. A category with only some points excluded
    // keeps `scored !== false` and is skipped per sub-item below.
    if (item.scored === false) continue;
    if (item.graded) {
      // Graded on the five-level scale (game jams): available points are
      // `weight × 10`, earning the graded tier's points times the weight. An
      // unjudged item earns nothing.
      total += GRADE_MAX_POINTS * item.weight;
      const status = statusOf(item.id);
      const points = (status && gradePoints(status)) || 0;
      earned += points * item.weight;
    } else if (!item.subItems || item.subItems.length === 0) {
      total += item.weight;
      if (passed(item.id)) earned += item.weight;
    } else {
      // A category of review items: the category's total is the sum of its
      // items' own weights, crediting each item that passed by its own weight.
      for (const sub of item.subItems) {
        // Skip a sub-item excluded from scoring for the version, exactly as a whole
        // excluded item is skipped above.
        if (sub.scored === false) continue;
        const weight = sub.weight ?? 1;
        total += weight;
        if (passed(subItemVerdictId(item.id, sub.id))) earned += weight;
      }
    }
  }
  return { earned, total };
}

/**
 * A run's aggregate score across all of its reviews: the mean weight earned over
 * the shared total. A run can carry more than one review; the declared checklist
 * (and so the total) is the same for each, so `earned` is averaged and is
 * therefore fractional. Mirrors `AggregateScore` in the Rust core.
 */
export interface AggregateScore {
  /** The mean weight earned across the run's reviews, or the validator-decided
   * weight earned on a validator-rated run. */
  earned: number;
  /** The total weight available — identical across the run's reviews. */
  total: number;
  /** How many reviews the average is taken over. `0` for a validator-scored run
   * ({@link validatorScore}), whose score comes from the validators rather than
   * from any review. */
  reviews: number;
}

/**
 * The aggregate score across a run's per-review {@link Score}s: the mean weight
 * earned over the shared total, or null when there are no reviews. Mirrors
 * `aggregate_score` in the Rust core.
 */
export function aggregateScore(
  scores: readonly Score[],
): AggregateScore | null {
  if (scores.length === 0) return null;
  const total = scores.reduce((max, s) => Math.max(max, s.total), 0);
  const earned = scores.reduce((sum, s) => sum + s.earned, 0) / scores.length;
  return { earned, total, reviews: scores.length };
}

/**
 * The aggregate overall rating across a run's reviews: the worst (lowest) rating
 * any reviewer gave any domain, or null when there are none. Each entry is one
 * review's per-domain ratings. Mirrors `aggregate_rating` in the Rust core.
 */
export function aggregateRating(
  reviews: readonly (readonly DomainRating[])[],
): Rating | null {
  return worstRating(
    reviews.flatMap((ratings) => ratings.map((r) => r.rating)),
  );
}

/**
 * One review's whole-game overall grade: the graded status of its reserved
 * {@link OVERALL_VERDICT_ID} checklist verdict, or null when the review records
 * none (a non-jam review). Mirrors `Writeup::overall_grade` in the Rust core.
 */
export function overallGradeOf(
  checklist: readonly ReviewVerdict[],
): GradeStatus | null {
  const verdict = checklist.find((v) => v.id === OVERALL_VERDICT_ID);
  return verdict && isGrade(verdict.status) ? verdict.status : null;
}

/**
 * The aggregate overall game grade across a run's reviews: the worst (lowest-point)
 * overall grade any reviewer gave, or null when none carry one (a non-jam run, or a
 * jam run with no reviews). Each entry is one review's checklist verdicts. A jam has
 * no scoring domains, so this whole-game mark is the run's rating badge in place of
 * a per-domain rating. Mirrors `aggregate_overall_grade` in the Rust core.
 */
export function aggregateOverallGrade(
  reviews: readonly (readonly ReviewVerdict[])[],
): GradeStatus | null {
  const grades: GradeStatus[] = [];
  for (const checklist of reviews) {
    const grade = overallGradeOf(checklist);
    if (grade) grades.push(grade);
  }
  return worstGrade(grades);
}

/**
 * **The automated toolchain gate, applied to a run's aggregate rating.**
 *
 * A run whose case declares a gating `typecheck` and whose typecheck ran and
 * exited non-zero is `broken`, whatever its reviewers said, because code that does
 * not compile is not reviewable. `gated` is the run record's `toolchain` block
 * answering {@link isToolchainGated}; `reviewed` is what {@link aggregateRating}
 * produced.
 *
 * The gate is applied *here*, over the aggregate, and never written into a
 * reviewer's stored verdicts: those are evidence, they are edited by their author,
 * and a run re-evaluated with the gate lifted must recover the reviewers' real
 * conclusion unchanged. A gated run is `broken` even with no reviews at all — the
 * gate is a statement about the build, not an average of opinions.
 *
 * Mirrors `gated_rating` in the Rust core.
 */
export function gatedRating(
  gated: boolean,
  reviewed: Rating | null,
): Rating | null {
  return gated ? "broken" : reviewed;
}

/**
 * **The automated toolchain gate, applied to a run's aggregate score.**
 *
 * A gated run scores zero and keeps its denominator, so it reads as `0 / total`
 * rather than as unscored. A gated run with no reviews stays null: the score is
 * defined over reviews, so there is no denominator to report a zero against, and
 * its `broken` rating is the signal instead. Mirrors `gated_score` in the Rust
 * core.
 */
export function gatedScore(
  gated: boolean,
  reviewed: AggregateScore | null,
): AggregateScore | null {
  if (!gated || reviewed === null) return reviewed;
  return { ...reviewed, earned: 0 };
}

/**
 * **The automated toolchain gate, applied to a game jam's overall grade.**
 *
 * A jam has no scoring domains — its badge is the reviewers' whole-game grade — so
 * the gate forces the worst tier there instead. Mirrors `gated_overall_grade` in
 * the Rust core.
 */
export function gatedOverallGrade(
  gated: boolean,
  reviewed: GradeStatus | null,
): GradeStatus | null {
  return gated ? "broken" : reviewed;
}

/**
 * The gate predicate itself: whether a run record's toolchain block disqualifies
 * the run. Exactly `typecheck.ran && !typecheck.succeeded` — a typecheck that never
 * ran has learned nothing about whether the code compiles and must not gate.
 * Mirrors `ToolchainSummary::gates` in the Rust core.
 */
export function isToolchainGated(
  toolchain:
    | { typecheck: { ran: boolean; succeeded: boolean } }
    | null
    | undefined,
): boolean {
  return toolchain
    ? toolchain.typecheck.ran && !toolchain.typecheck.succeeded
    : false;
}

/**
 * The verdicts a run's validators decided, synthesized as {@link ReviewVerdict}s
 * — the **failure semantics** shared by {@link automatedOnlyScore} and
 * {@link validatorDomainRatings}:
 * - A script with decided verdicts contributes each (`pass` → `pass`, else `fail`).
 * - A script that suffered a contract failure (`ran === false`) with no decided
 *   verdict **fails** the point it backs.
 * - A script recorded inconclusive (`preconditionUnmet`) is skipped entirely, as
 *   is a clean run that emitted no verdict.
 *
 * The ids of the returned verdicts are exactly the auto-covered points. Mirrors
 * `automated_verdicts` in the Rust core (crates/core/src/comparison.rs).
 */
export function automatedVerdicts(
  debugScripts: readonly DebugScriptResult[],
): ReviewVerdict[] {
  const verdicts: ReviewVerdict[] = [];
  for (const script of debugScripts) {
    if (script.preconditionUnmet) continue;
    if (script.verdicts.length === 0) {
      if (!script.ran) {
        const id =
          script.subItemId != null
            ? subItemVerdictId(script.itemId, script.subItemId)
            : script.itemId;
        verdicts.push({ id, status: "fail" });
      }
      continue;
    }
    for (const v of script.verdicts) {
      verdicts.push({ id: v.id, status: v.pass ? "pass" : "fail" });
    }
  }
  return verdicts;
}

/**
 * A run's **automated-only** score: {@link scoreChecklist} restricted to the
 * checklist points a machine actually checked, so both numerator and denominator
 * drop the human-only points (a Carom run whose 68 automated points all pass reads
 * 68/68, not 68/70). `items` must already be the run's **effective** checklist. A
 * thin wrapper over {@link coveredScore} on the {@link automatedVerdicts}. Mirrors
 * `automated_only_score` in the Rust core (crates/core/src/comparison.rs).
 */
export function automatedOnlyScore(
  items: readonly WeightedItem[],
  debugScripts: readonly DebugScriptResult[],
): Score {
  return coveredScore(items, automatedVerdicts(debugScripts));
}

/**
 * Score a slice of `verdicts` over `items`, restricting **both** numerator and
 * denominator to the points the verdicts actually decide: the covered set is
 * exactly the verdict ids, an undecided point is excluded rather than failed, and
 * an erratum-excluded point (`scored === false`) counts toward neither side.
 *
 * The verdict-slice core of {@link automatedOnlyScore}, generalized so a review's
 * {@link effectiveVerdicts | effective checklist} — the validators' verdicts
 * overlaid with the reviewer's overrides — scores through the identical rule (see
 * {@link validatorReviewScore}). Mirrors `covered_score` in the Rust core
 * (crates/core/src/comparison.rs).
 */
export function coveredScore(
  items: readonly WeightedItem[],
  verdicts: readonly ReviewVerdict[],
): Score {
  const covered = new Set(verdicts.map((v) => v.id));
  return scoreChecklist(restrictItemsToCovered(items, covered), verdicts);
}

/**
 * Restrict `items` to only the checklist points in `covered`, so the score's
 * denominator is exactly the covered weight. A binary or graded item is kept iff
 * its own id is covered; a category keeps only its covered sub-items and is
 * dropped entirely when none are covered. Mirrors `restrict_items_to_covered` in
 * the Rust core (crates/core/src/comparison.rs).
 */
function restrictItemsToCovered(
  items: readonly WeightedItem[],
  covered: ReadonlySet<string>,
): WeightedItem[] {
  const restricted: WeightedItem[] = [];
  for (const item of items) {
    if (item.graded || !item.subItems || item.subItems.length === 0) {
      if (covered.has(item.id)) restricted.push(item);
    } else {
      const subItems = item.subItems.filter((sub) =>
        covered.has(subItemVerdictId(item.id, sub.id)),
      );
      if (subItems.length > 0) restricted.push({ ...item, subItems });
    }
  }
  return restricted;
}

/**
 * **The validator-decided functional rating, per domain.**
 *
 * On a validator-rated run every domain starts `flawless`. For each **scored**
 * validated point that **failed** (the {@link automatedVerdicts} semantics) each of
 * the point's declared `domains` is lowered to `min(current, FAILURE_CAP_RATING[cap])`,
 * so a domain ends at the lowest cap among its failures. An inconclusive point, a
 * point with no script result, and a point excluded from scoring (`scored === false`)
 * never lower anything; a verdict naming no declared point is ignored. `items` must
 * be the run's effective checklist and `domains` its effective domain ids, in order.
 * A thin wrapper over {@link verdictDomainRatings}, which applies the same
 * failure-cap rule to a verdict slice the caller already holds. Mirrors
 * `validator_domain_ratings` in the Rust core.
 */
export function validatorDomainRatings(
  domains: readonly { id: string }[],
  items: readonly WeightedItem[],
  debugScripts: readonly DebugScriptResult[],
): DomainRating[] {
  return verdictDomainRatings(domains, items, automatedVerdicts(debugScripts));
}

/**
 * The per-domain functional ratings a slice of `verdicts` decides — the
 * failure-cap core of {@link validatorDomainRatings}, generalized so a review's
 * {@link effectiveVerdicts | effective checklist} (validator verdicts overlaid
 * with the reviewer's overrides) rates through the identical rule.
 *
 * Every domain starts `flawless`; each **failing** verdict on a **scored** point
 * lowers each of the point's declared `domains` to
 * `min(current, FAILURE_CAP_RATING[cap])`. A point with no verdict, a point
 * excluded from scoring (`scored === false`, an erratum), and a verdict naming no
 * declared point never lower anything. Mirrors `verdict_domain_ratings` in the
 * Rust core.
 */
export function verdictDomainRatings(
  domains: readonly { id: string }[],
  items: readonly WeightedItem[],
  verdicts: readonly ReviewVerdict[],
): DomainRating[] {
  const ratings: DomainRating[] = domains.map((domain) => ({
    domain: domain.id,
    rating: "flawless",
  }));
  const lower = (domain: string, cap: FailureCap) => {
    const entry = ratings.find((r) => r.domain === domain);
    if (!entry) return;
    entry.rating =
      worstRating([entry.rating, FAILURE_CAP_RATING[cap]]) ?? entry.rating;
  };
  for (const verdict of verdicts) {
    if (verdict.status !== "fail") continue;
    const point = failingPoint(items, verdict.id);
    if (!point) continue;
    for (const domain of point.domains) lower(domain, point.cap);
  }
  return ratings;
}

/**
 * The failure cap and domains of the **scored** point `verdictId` names in `items`,
 * or null when it names no scored point or the point declares no cap (a legacy
 * point, which cannot lower a domain). Mirrors `failing_point` in the Rust core.
 */
function failingPoint(
  items: readonly WeightedItem[],
  verdictId: string,
): { cap: FailureCap; domains: readonly string[] } | null {
  for (const item of items) {
    if (item.scored === false) continue;
    if (!item.subItems || item.subItems.length === 0) {
      if (item.id === verdictId) {
        return item.failureCap
          ? { cap: item.failureCap, domains: item.domains ?? [] }
          : null;
      }
      continue;
    }
    for (const sub of item.subItems) {
      if (
        sub.scored !== false &&
        subItemVerdictId(item.id, sub.id) === verdictId
      ) {
        return sub.failureCap
          ? { cap: sub.failureCap, domains: sub.domains ?? [] }
          : null;
      }
    }
  }
  return null;
}

/**
 * **The validator-decided functional rating of a run**: the worst across its
 * {@link validatorDomainRatings}, composed with the toolchain gate
 * ({@link gatedRating}). Always non-null for a validator-rated run — with zero
 * failures it is `flawless` — since the domain set is never empty. Mirrors
 * `validator_rating` in the Rust core.
 */
export function validatorRating(
  gated: boolean,
  domainRatings: readonly DomainRating[],
): Rating | null {
  return gatedRating(gated, worstRating(domainRatings.map((r) => r.rating)));
}

/**
 * **The validator-decided score of a run**: the {@link automatedOnlyScore} over the
 * run's effective `items` and its record's `debugScripts`, composed with the
 * toolchain gate ({@link gatedScore}). This is the run's score while it has no
 * reviews — available the moment the run completes (`reviews` is `0`); once
 * reviews exist, {@link validatorAggregateScore} folds their overrides in. A thin
 * wrapper over {@link coveredScore} on the {@link automatedVerdicts}. Mirrors
 * `validator_score` in the Rust core.
 */
export function validatorScore(
  gated: boolean,
  items: readonly WeightedItem[],
  debugScripts: readonly DebugScriptResult[],
): AggregateScore {
  return verdictsOwnScore(gated, items, automatedVerdicts(debugScripts));
}

/**
 * The verdict-slice core of {@link validatorScore}, and the zero-review fixed
 * point of {@link validatorAggregateScore}: the {@link coveredScore} of
 * `verdicts` over `items`, gated, with `reviews` `0`. Mirrors
 * `verdicts_own_score` in the Rust core.
 */
function verdictsOwnScore(
  gated: boolean,
  items: readonly WeightedItem[],
  verdicts: readonly ReviewVerdict[],
): AggregateScore {
  const { earned, total } = coveredScore(items, verdicts);
  return { earned: gated ? 0 : earned, total, reviews: 0 };
}

/**
 * A review's **effective checklist** on a validator-rated run: the validators'
 * verdicts (`auto`, from {@link automatedVerdicts}) overlaid with that review's
 * `overrides` — the reviewer wins per verdict id, and an override naming a point
 * the validators left undecided (an unmet precondition, say) decides it, appended
 * after the validators' points. A point the reviewer left untouched keeps the
 * validators' verdict, so a review with no overrides is exactly the validators'
 * checklist. Mirrors `effective_verdicts` in the Rust core.
 */
export function effectiveVerdicts(
  auto: readonly ReviewVerdict[],
  overrides: readonly ReviewVerdict[],
): ReviewVerdict[] {
  const effective = auto.map(
    (verdict) => overrides.find((o) => o.id === verdict.id) ?? verdict,
  );
  for (const verdict of overrides) {
    if (!auto.some((a) => a.id === verdict.id)) effective.push(verdict);
  }
  return effective;
}

/**
 * One review's functional rating on a validator-rated run: the worst across the
 * per-domain ratings its {@link effectiveVerdicts | effective checklist} decides
 * (validators' `auto` verdicts overlaid with the review's `overrides`), with the
 * toolchain gate ({@link gatedRating}) on top. A review with no overrides
 * reproduces {@link validatorRating} over the validators' own domain ratings
 * exactly. Mirrors `validator_review_rating` in the Rust core.
 */
export function validatorReviewRating(
  gated: boolean,
  domains: readonly { id: string }[],
  items: readonly WeightedItem[],
  auto: readonly ReviewVerdict[],
  overrides: readonly ReviewVerdict[],
): Rating | null {
  const effective = effectiveVerdicts(auto, overrides);
  return validatorRating(
    gated,
    verdictDomainRatings(domains, items, effective),
  );
}

/**
 * One review's score on a validator-rated run: the {@link coveredScore} of its
 * {@link effectiveVerdicts | effective checklist} — numerator **and** denominator
 * restricted to the points holding an effective verdict, mirroring
 * {@link automatedOnlyScore}'s exclusion rule, with erratum-excluded points
 * counting toward neither side — zeroed by the toolchain gate. A review with no
 * overrides reproduces the automated-only score exactly; one that decides a point
 * the validators left undecided grows the denominator by that point's weight.
 * Mirrors `validator_review_score` in the Rust core.
 */
export function validatorReviewScore(
  gated: boolean,
  items: readonly WeightedItem[],
  auto: readonly ReviewVerdict[],
  overrides: readonly ReviewVerdict[],
): Score {
  const score = coveredScore(items, effectiveVerdicts(auto, overrides));
  return { earned: gated ? 0 : score.earned, total: score.total };
}

/**
 * A validator-rated run's aggregate functional rating across its `reviews` (each
 * one review's overrides): with zero reviews, the validators' own rating
 * ({@link validatorRating}, unchanged); with one or more, the **worst** across
 * the reviews' {@link validatorReviewRating | effective ratings}. A review with
 * no overrides reproduces the validators' figures exactly, so today's behavior is
 * the fixed point. The toolchain gate applies at this aggregation seam
 * ({@link gatedRating}). Mirrors `validator_aggregate_rating` in the Rust core.
 */
export function validatorAggregateRating(
  gated: boolean,
  domains: readonly { id: string }[],
  items: readonly WeightedItem[],
  auto: readonly ReviewVerdict[],
  reviews: readonly (readonly ReviewVerdict[])[],
): Rating | null {
  let worst: Rating | null = null;
  if (reviews.length === 0) {
    const ratings = verdictDomainRatings(domains, items, auto);
    worst = worstRating(ratings.map((r) => r.rating));
  } else {
    for (const overrides of reviews) {
      const effective = effectiveVerdicts(auto, overrides);
      const ratings = verdictDomainRatings(domains, items, effective);
      const reviewWorst = worstRating(ratings.map((r) => r.rating));
      worst = worstRating(
        [worst, reviewWorst].filter((r): r is Rating => r !== null),
      );
    }
  }
  return gatedRating(gated, worst);
}

/**
 * A validator-rated run's aggregate score across its `reviews` (each one review's
 * overrides): with zero reviews, the validators' own score
 * ({@link validatorScore}, `reviews` `0`); with one or more, the **average** of
 * the reviews' {@link validatorReviewScore | effective scores} over the shared
 * total (via {@link aggregateScore}). A review with no overrides reproduces the
 * validators' figures exactly, so today's behavior is the fixed point. The
 * toolchain gate applies at this aggregation seam ({@link gatedScore}). Mirrors
 * `validator_aggregate_score` in the Rust core.
 */
export function validatorAggregateScore(
  gated: boolean,
  items: readonly WeightedItem[],
  auto: readonly ReviewVerdict[],
  reviews: readonly (readonly ReviewVerdict[])[],
): AggregateScore {
  const scores = reviews.map((overrides) =>
    coveredScore(items, effectiveVerdicts(auto, overrides)),
  );
  const aggregate = aggregateScore(scores);
  if (aggregate === null) return verdictsOwnScore(gated, items, auto);
  // A scored aggregate stays scored: `gatedScore` only returns null for null.
  return gatedScore(gated, aggregate) as AggregateScore;
}
