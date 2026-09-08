import { type FailureCap, FAILURE_CAP_META } from "../ratings";
import { RatingBadge } from "./RatingBadge";

/**
 * Whether a review item's failure cap is in force: `failed` applies it; every
 * other outcome leaves the affected domains untouched by this item.
 */
export type FailureCapOutcome = "failed" | "passed" | "undecided" | "unscored";

interface FailureCapBadgeProps {
  /** The tier the item caps its domains at while it fails. */
  cap: FailureCap;
  /** The item's outcome, which decides whether the cap is in force. Omitted
   * for a checklist shown as a definition rather than against a run, where
   * there is no verdict to apply it. */
  outcome?: FailureCapOutcome;
  /** Display names of the domains a failure lowers, for the explanation. */
  domains?: readonly string[];
  className?: string;
}

const OUTCOME_NOTE: Record<FailureCapOutcome, string> = {
  failed: "This item failed, so its cap is in force.",
  passed: "This item passed, so its cap does not apply.",
  undecided: "This item is undecided, so its cap does not apply.",
  unscored: "This item is not scored, so its cap never applies.",
};

/** "Single player", "Single player and Versus", "A, B, and C". */
function formatList(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

/**
 * The hover text on a failure-cap badge: what a cap is, what this one is worth,
 * and whether it is in force on this item.
 */
export function failureCapExplanation(
  cap: FailureCap,
  outcome?: FailureCapOutcome,
  domains: readonly string[] = [],
): string {
  const affected =
    domains.length > 0 ? ` Here that is ${formatList(domains)}.` : "";
  const parts = [
    `Failure cap: ${FAILURE_CAP_META[cap].label}.`,
    "Every review item declares the highest functional rating the domains it affects can reach while the item fails; a domain settles at the lowest cap among its failing items, and the run's functional rating is its worst domain.",
    FAILURE_CAP_META[cap].description + affected,
  ];
  if (outcome) parts.push(OUTCOME_NOTE[outcome]);
  return parts.join(" ");
}

// A review item's failure cap as a rating chip: the tier the item's domains can
// rate no better than while it fails. Shown on every capped item — in the
// tier's color while the item fails (the cap is in force) and greyed out
// otherwise — so a reader always sees what a failure costs, and which failures
// actually cost it. The hover text explains what a cap is and whether this one
// applies.
export function FailureCapBadge({
  cap,
  outcome,
  domains = [],
  className,
}: FailureCapBadgeProps) {
  return (
    <RatingBadge
      rating={cap}
      className={className}
      muted={outcome !== undefined && outcome !== "failed"}
      title={failureCapExplanation(cap, outcome, domains)}
    />
  );
}
