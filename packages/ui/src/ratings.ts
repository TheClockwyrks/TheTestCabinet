// Implementation ratings: the reviewer's subjective quality tier for a finished
// run, assigned by hand while playing the build. A rating is curatorial — it
// rides in a run's review, never in the run record, and is shown per run but
// never aggregated or used to rank (the gallery is not a leaderboard).
//
// This mirrors the `Rating` enum in the Rust core (crates/core/src/review.rs);
// keep the tiers in lockstep.

/** A quality tier, ordered best to worst. */
export type Rating = "flawless" | "great" | "scuffed" | "broken";

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

/** A reviewer's verdict on one declared checklist item. */
export type VerdictStatus = "pass" | "fail" | "na";

/** Display metadata for a verdict status. */
export const VERDICT_META: Record<VerdictStatus, { label: string }> = {
  pass: { label: "Pass" },
  fail: { label: "Fail" },
  na: { label: "N/A" },
};

/** A reviewer's recorded verdict on one declared checklist item. */
export interface ReviewVerdict {
  /** The declared item's stable id. */
  id: string;
  /** The reviewer's verdict. */
  status: VerdictStatus;
  /** An optional one-line note, when the reviewer left one. */
  note?: string;
}

/** Narrowing type guard for {@link VerdictStatus}. */
export function isVerdictStatus(value: string): value is VerdictStatus {
  return value === "pass" || value === "fail" || value === "na";
}
