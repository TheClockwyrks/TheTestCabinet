// Implementation ratings: the reviewer's subjective quality tier for one of a
// test case's scoring domains, assigned by hand while playing the build. A run is
// rated per domain; its overall rating is the worst across them. Each review item
// carries a point weight, and the run's score is the weight of its passed items
// over the total declared weight.
//
// The review *types* (Rating, VerdictStatus, DomainRating, ReviewVerdict) are
// generated from the Rust core (crates/core/src/review.rs) and imported here; this
// module owns only the UI-side display metadata and the scoring/aggregation logic.

import type {
  DomainRating,
  Rating,
  RatingChange,
  ReviewDiff,
  ReviewRevision,
  ReviewVerdict,
  VerdictChange,
  VerdictStatus,
  WriteupChange,
} from "@test-cabinet/run-record/review";

export type {
  DomainRating,
  Rating,
  RatingChange,
  ReviewDiff,
  ReviewRevision,
  ReviewVerdict,
  VerdictChange,
  VerdictStatus,
  WriteupChange,
};

/** Every rating, ordered best to worst. */
export const RATINGS: readonly Rating[] = [
  "flawless",
  "great",
  "passable",
  "scuffed",
  "broken",
];

/** Display metadata for a rating tier. */
export interface RatingMeta {
  /** Title-case label, e.g. "Great". */
  label: string;
  /** What the tier means, shown alongside the label on a run's page. */
  description: string;
}

export const RATING_META: Record<Rating, RatingMeta> = {
  flawless: {
    label: "Flawless",
    description: "Implemented according to spec with no noticeable bugs.",
  },
  great: {
    label: "Great",
    description:
      "Implemented according to spec. May have minor issues so long as they don't impact playability.",
  },
  passable: {
    label: "Passable",
    description:
      "Implemented to spec and playable, but with rough edges beyond the minor issues of a great run — noticeable, though not enough to deviate from the spec or impair playability.",
  },
  scuffed: {
    label: "Scuffed",
    description:
      "Mostly implemented according to spec. Playable, but may deviate from the spec or have bugs that impact playability.",
  },
  broken: {
    label: "Broken",
    description:
      "Doesn't follow the spec or has bugs severe enough to render the game unplayable.",
  },
};

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

/** Display metadata for a graded tier: its emoji, title-case label, and points. */
export interface GradeMeta {
  /** The tier's emoji, shown on the grade buttons and badge. */
  emoji: string;
  /** Title-case label, e.g. "Neutral". */
  label: string;
  /** The points the tier is worth (before the item's weight): 0/1/3/5/10. */
  points: number;
}

/**
 * The five graded tiers keyed by status, worst to best. The point values
 * (0/1/3/5/10) mirror `VerdictStatus::grade_points` in the Rust core; keep the two
 * in lockstep.
 */
export const GRADE_META: Record<GradeStatus, GradeMeta> = {
  broken: { emoji: "💩", label: "Broken", points: 0 },
  poor: { emoji: "🙁", label: "Not great", points: 1 },
  neutral: { emoji: "😐", label: "Neutral", points: 3 },
  great: { emoji: "😀", label: "Great", points: 5 },
  incredible: { emoji: "💎", label: "Incredible", points: 10 },
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
 * The points one of the five graded tiers is worth (0/1/3/5/10), or `undefined`
 * for the binary `pass`/`fail`. Mirrors `VerdictStatus::grade_points` in the Rust
 * core.
 */
export function gradePoints(status: VerdictStatus): number | undefined {
  return isGrade(status) ? GRADE_META[status].points : undefined;
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
    const points = GRADE_META[grade].points;
    if (points < worstPoints) {
      worstPoints = points;
      worst = grade;
    }
  }
  return worst;
}

/** Display metadata for a verdict status. The graded tiers reuse their
 * {@link GRADE_META} labels so both scales share one source of truth. */
export const VERDICT_META: Record<VerdictStatus, { label: string }> = {
  pass: { label: "Pass" },
  fail: { label: "Fail" },
  broken: { label: GRADE_META.broken.label },
  poor: { label: GRADE_META.poor.label },
  neutral: { label: GRADE_META.neutral.label },
  great: { label: GRADE_META.great.label },
  incredible: { label: GRADE_META.incredible.label },
};

/** Narrowing type guard for {@link VerdictStatus} — the binary pass/fail plus the
 * five graded tiers. */
export function isVerdictStatus(value: string): value is VerdictStatus {
  return value === "pass" || value === "fail" || isGrade(value);
}

/**
 * Format a point value for display: a whole number as-is, and a fractional one
 * (an item with sub-items can earn a fraction of its weight) to at most two
 * decimals with trailing zeros trimmed — so `2` stays `2`, `0.5` shows `0.5`,
 * and `1/3` shows `0.33`.
 */
export function formatPoints(points: number): string {
  if (Number.isInteger(points)) return String(points);
  return points.toFixed(2).replace(/\.?0+$/, "");
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
  /** The mean weight earned across the run's reviews. */
  earned: number;
  /** The total weight available — identical across the run's reviews. */
  total: number;
  /** How many reviews the average is taken over. */
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
