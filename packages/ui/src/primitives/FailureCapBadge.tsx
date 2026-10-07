import type { FailureCap } from "../ratings";
import { RatingBadge } from "./RatingBadge";

/**
 * Whether a review item's failure cap is in force: `failed` applies it; every
 * other outcome leaves the affected domains untouched by this item.
 */
export type FailureCapOutcome = "failed" | "passed" | "undecided" | "unscored";

/** The hover text on every failure-cap badge, whatever its outcome. */
const FAILURE_CAP_TITLE = "Rating cap applied on failure.";

interface FailureCapBadgeProps {
  /** The tier the item caps its domains at while it fails. */
  cap: FailureCap;
  /** The item's outcome, which decides whether the cap is in force. Omitted
   * for a checklist shown as a definition rather than against a run, where
   * there is no verdict to apply it. */
  outcome?: FailureCapOutcome;
  className?: string;
}

// A review item's failure cap as a rating chip: the tier the item's domains can
// rate no better than while it fails. Shown on every capped item — in the
// tier's color while the item fails (the cap is in force) and dimmed
// otherwise — so a reader always sees what a failure costs, and which failures
// actually cost it. The hover text says what the badge is.
export function FailureCapBadge({
  cap,
  outcome,
  className,
}: FailureCapBadgeProps) {
  return (
    <RatingBadge
      rating={cap}
      className={className}
      muted={outcome !== undefined && outcome !== "failed"}
      title={FAILURE_CAP_TITLE}
    />
  );
}
