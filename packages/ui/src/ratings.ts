// Implementation ratings: the reviewer's subjective quality tier for one of a
// test case's scoring domains, assigned by hand while playing the build. A run is
// rated per domain; its overall rating is the worst across them. Each review item
// carries a point weight, and the run's score is the weight of its passed items
// over the total declared weight.
//
// The review *types* (Rating, VerdictStatus, DomainRating, ReviewVerdict) are
// generated from the Rust core (crates/core/src/review.rs) and imported here.
//
// The scoring and aggregation *rules* used to live here too, but they are shared
// with consumers that must not depend on React — anything computing the same
// figure outside a browser bundle — so they moved to `@test-cabinet/run-stats` and
// are re-exported below. Every existing import of them from this module keeps
// working; what this module still owns is the **display** metadata that goes with
// them (labels, emoji, prose descriptions), which is presentation and belongs to
// the UI.

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
import {
  GRADE_POINTS,
  type GradeStatus,
} from "@test-cabinet/run-stats/scoring";

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

// The scoring rules themselves, re-exported so this module stays the one place
// the UI reaches for anything rating-related.
export * from "@test-cabinet/run-stats/scoring";

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

/** Display metadata for a graded tier: its emoji, title-case label, and points. */
export interface GradeMeta {
  /** The tier's emoji, shown on the grade buttons and badge. */
  emoji: string;
  /** Title-case label, e.g. "Neutral". */
  label: string;
  /** The points the tier is worth (before the item's weight): 0/2/5/8/10. */
  points: number;
}

/**
 * The five graded tiers keyed by status, worst to best. The point values are read
 * from `GRADE_POINTS` in `@test-cabinet/run-stats` rather than restated, so the
 * scale that scores a run and the scale shown beside it can never disagree.
 */
export const GRADE_META: Record<GradeStatus, GradeMeta> = {
  broken: { emoji: "💩", label: "Broken", points: GRADE_POINTS.broken },
  poor: { emoji: "🙁", label: "Not great", points: GRADE_POINTS.poor },
  neutral: { emoji: "😐", label: "Neutral", points: GRADE_POINTS.neutral },
  great: { emoji: "😀", label: "Great", points: GRADE_POINTS.great },
  incredible: {
    emoji: "💎",
    label: "Incredible",
    points: GRADE_POINTS.incredible,
  },
};

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
