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
  ReviewVerdict,
  VerdictStatus,
} from "@test-cabinet/run-record/review";

export type { DomainRating, Rating, ReviewVerdict, VerdictStatus };

/** Every rating, ordered best to worst. */
export const RATINGS: readonly Rating[] = [
  "flawless",
  "great",
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

/** Display metadata for a verdict status. */
export const VERDICT_META: Record<VerdictStatus, { label: string }> = {
  pass: { label: "Pass" },
  fail: { label: "Fail" },
};

/** Narrowing type guard for {@link VerdictStatus}. */
export function isVerdictStatus(value: string): value is VerdictStatus {
  return value === "pass" || value === "fail";
}

/** A run's numeric score: the point weight earned over the total available. */
export interface Score {
  /** The weight of the items the reviewer marked `pass`. */
  earned: number;
  /** The total weight of every declared item — the points available. */
  total: number;
}

/** The minimal shape {@link scoreChecklist} needs from a declared review item. */
export interface WeightedItem {
  id: string;
  weight: number;
}

/**
 * Score a run by combining the case's declared `items` (which carry the point
 * weights) with the reviewer's `verdicts`: an item earns its weight when marked
 * `pass` and none when marked `fail`. The total is the sum of every item's
 * weight. Mirrors `score` in the Rust core.
 */
export function scoreChecklist(
  items: readonly WeightedItem[],
  verdicts: readonly ReviewVerdict[],
): Score {
  let earned = 0;
  let total = 0;
  for (const item of items) {
    total += item.weight;
    if (verdicts.some((v) => v.id === item.id && v.status === "pass")) {
      earned += item.weight;
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
export function aggregateScore(scores: readonly Score[]): AggregateScore | null {
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
  return worstRating(reviews.flatMap((ratings) => ratings.map((r) => r.rating)));
}
