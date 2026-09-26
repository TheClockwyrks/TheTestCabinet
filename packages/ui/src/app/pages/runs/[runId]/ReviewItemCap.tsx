import type { ReactNode } from "react";
import { FailureCapBadge, type FailureCapOutcome } from "@clockwyrks/ui";
import type { FailureCap, VerdictStatus } from "../../../data/ratings";
import styles from "../RunExec.module.scss";

/**
 * Whether a review item's failure cap is in force, from its effective verdict
 * and whether the point counts toward the score. A point excluded from scoring
 * (an erratum's `excludeFromScore`) never caps anything, whatever its verdict.
 */
export function capOutcome(
  status: VerdictStatus | "" | undefined,
  notScored: boolean,
): FailureCapOutcome {
  if (notScored) return "unscored";
  if (status === "fail") return "failed";
  if (status === "pass") return "passed";
  return "undecided";
}

/**
 * The heading of one browsed or reviewed point: its number, title, and points
 * (or its "not scored" mark) on the left, and — on a capped point — its failure
 * cap as a rating badge at the right edge of the same row, lit while the point
 * fails and its cap is in force, dimmed otherwise. Shared by the read-only
 * browser and the review editor's walker so the two heads read identically.
 */
export function ReviewItemHeading({
  number,
  title,
  points,
  notScored,
  cap,
  outcome,
}: {
  /** The point's position in the walk, 1-based. */
  number: number;
  title: string;
  /** The formatted points label (`2 pts`, `5 / 10 pts`). Ignored while the
   * point is not scored. */
  points: ReactNode;
  /** Whether the point is excluded from scoring for the version. */
  notScored: boolean;
  /** The point's failure cap, when it carries one. */
  cap?: FailureCap | null;
  /** Whether that cap is in force. */
  outcome: FailureCapOutcome;
}) {
  return (
    <div className={styles.checklistTitleRow}>
      <span className={styles.checklistTitle}>
        <span className={styles.checklistNumber}>{number}.</span> {title}{" "}
        {notScored ? (
          <span className={styles.notScored}>Not scored</span>
        ) : (
          <>({points})</>
        )}
      </span>
      {cap && (
        <FailureCapBadge
          cap={cap}
          outcome={outcome}
          className={styles.titleCap}
        />
      )}
    </div>
  );
}
