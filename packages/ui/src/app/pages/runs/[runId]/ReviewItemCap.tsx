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

/** "Single player", "Single player and Versus", "A, B, and C". Ids fall back
 * where no name is known. */
export function formatDomainNames(
  ids: readonly string[],
  nameById: ReadonlyMap<string, string>,
): string[] {
  return ids.map((id) => nameById.get(id) ?? id);
}

function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

const NOT_APPLIED: Record<Exclude<FailureCapOutcome, "failed">, string> = {
  passed: "this item passed, so it does not apply.",
  undecided: "this item is undecided, so it does not apply.",
  unscored: "this item is not scored, so it never applies.",
};

/**
 * The failure-cap line of one browsed or reviewed point: the cap as a rating
 * badge (colored while the item fails, greyed otherwise) followed by the
 * domains a failure lowers and whether the cap is in force. Always shown on a
 * capped point, so a reader sees what every item is worth beyond its points,
 * not only the ones that failed.
 */
export function ReviewItemCapNote({
  cap,
  outcome,
  domains,
}: {
  cap: FailureCap;
  outcome: FailureCapOutcome;
  /** Display names of the affected domains. */
  domains: readonly string[];
}) {
  const affected = joinNames(domains) || "its domains";
  return (
    <p
      className={styles.capNote}
      data-applied={outcome === "failed" ? "true" : undefined}
    >
      <FailureCapBadge cap={cap} outcome={outcome} domains={domains} />
      <span>
        {outcome === "failed"
          ? `Failing caps ${affected}.`
          : `Failing would cap ${affected}; ${NOT_APPLIED[outcome]}`}
      </span>
    </p>
  );
}
