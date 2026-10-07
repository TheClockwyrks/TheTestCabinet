import type { DebugScriptResult, RunRecord } from "@clockwyrks/run-record";
import type {
  FailureCap,
  ReviewItem,
  VerdictStatus,
} from "../../../../client/types";
import type { ReviewItemSummary } from "../../../data/testCases";
import {
  automatedVerdicts,
  subItemVerdictId,
  verdictIdsForItem,
} from "../../../data/ratings";

/**
 * One auto-decided verdict from a run's debug scripts, keyed for pre-fill lookup by
 * verdict id (a review item's own id, or the `<item>.<sub>` composite).
 */
export interface AutoVerdictInfo {
  status: VerdictStatus;
  note: string;
}

/** The reviewer's in-progress answer for one verdict id. */
export interface VerdictDraft {
  status: VerdictStatus | "";
  note: string;
}

/**
 * The auto verdicts a run's debug scripts decided, keyed by verdict id. The
 * reviewer's checklist pre-fills from these (binary pass/fail), shown desaturated
 * until the reviewer overrides one. Empty when the case declares no automated
 * validation.
 *
 * These values live in the immutable run record, not in the review, so they stay
 * recoverable for the life of the run — which is what lets a reviewer restore an
 * overridden verdict to what validation actually decided, however many edits later.
 */
export function autoVerdictMap(run: RunRecord): Map<string, AutoVerdictInfo> {
  const map = new Map<string, AutoVerdictInfo>();
  // The shared failure semantics (`automatedVerdicts`): decided verdicts carry
  // through, a contract failure fails the point it backs, and an inconclusive
  // script leaves its point undecided, whichever of the reasons it gives — so the
  // pre-fill can never disagree with the score and rating derived from the same
  // record.
  for (const v of automatedVerdicts(run.validation.debugScripts ?? [])) {
    // The reviewer's note is left blank: a verdict's proof is its assertions,
    // shown beside the point, not stuffed into the note field.
    map.set(v.id, { status: v.status, note: "" });
  }
  return map;
}

/**
 * The verdict ids whose draft answer *differs* from what this run's validation
 * decided — the reviewer's overrides, and exactly the set a restore can put back.
 *
 * Only declared points are considered (an auto verdict for an item the case no
 * longer declares is not offered), and only ones validation actually decided: a
 * point it left to the reviewer — a subjective item, or a check that decided
 * nothing — has no machine value to restore and is never touched. A note is
 * reviewer prose either way (validation writes none), so it does not count as a
 * difference.
 */
export function overriddenAutoVerdictIds(
  items: ReviewItem[],
  auto: Map<string, AutoVerdictInfo>,
  verdicts: Record<string, VerdictDraft>,
): string[] {
  const out: string[] = [];
  for (const item of items) {
    for (const vid of verdictIdsForItem(item)) {
      const decided = auto.get(vid);
      if (!decided) continue;
      if ((verdicts[vid]?.status ?? "") !== decided.status) out.push(vid);
    }
  }
  return out;
}

/**
 * One line of the "what would change" list a restore is confirmed against: the
 * point in the reviewer's own vocabulary, what they answered, and what
 * validation decided.
 */
export interface RestoreChange {
  /** The verdict id being put back. */
  id: string;
  /** The point's own title — a sub-item's, or a whole item's. */
  title: string;
  /** The category a sub-item sits under. Empty for a whole item. */
  category: string;
  /** The reviewer's current answer, or `""` where they left the point unanswered. */
  from: VerdictStatus | "";
  /** What this run's validation decided, and so what the restore would set. */
  to: VerdictStatus;
}

/**
 * Spell out, point by point, exactly what restoring `ids` would change.
 *
 * The bulk restore discards the reviewer's own calls wholesale, and the count
 * alone ("restore 7 verdicts") does not tell them whether that is the correction
 * they meant — a reviewer who has worked through forty points cannot hold which
 * seven they overrode, nor which way each would flip. Enumerating them makes the
 * confirmation answerable rather than a leap.
 *
 * Ordered as `ids` is (the checklist's own order), and skipping any id validation
 * did not decide, since there is nothing to restore it to.
 */
export function describeAutoVerdictRestore(
  items: ReviewItem[],
  auto: Map<string, AutoVerdictInfo>,
  verdicts: Record<string, VerdictDraft>,
  ids: string[],
): RestoreChange[] {
  // Verdict id → where that point sits, so a line reads "Controls work › Keyboard"
  // rather than the raw `controls.kb`. `verdictIdsForItem` emits sub-item ids in
  // `subItems` order, which is what lets the two be zipped.
  const labels = new Map<string, { title: string; category: string }>();
  for (const item of items) {
    const subItems = item.subItems ?? [];
    verdictIdsForItem(item).forEach((vid, i) => {
      labels.set(vid, {
        title: subItems[i]?.title ?? item.title,
        category: subItems.length > 0 ? item.title : "",
      });
    });
  }

  const changes: RestoreChange[] = [];
  for (const id of ids) {
    const decided = auto.get(id);
    if (!decided) continue;
    const label = labels.get(id);
    changes.push({
      id,
      title: label?.title ?? id,
      category: label?.category ?? "",
      from: verdicts[id]?.status ?? "",
      to: decided.status,
    });
  }
  return changes;
}

/**
 * One failing validated point of a **validator-rated** run, in the reviewer's
 * vocabulary: what it is, what it capped, and which domains it capped. The rows
 * of the Verdict tab's per-domain breakdown ("which failing items capped each
 * domain").
 */
export interface ValidatorFailure {
  /** The verdict id that failed. */
  id: string;
  /** The point's own title — a sub-item's, or a whole item's. */
  title: string;
  /** The category a sub-item sits under. Empty for a whole item. */
  category: string;
  /** The failure cap the point declares. */
  cap: FailureCap;
  /** The scoring domain ids the failure lowers to `cap`. */
  domains: readonly string[];
}

/**
 * The **scored** points this run's validators failed, each with the cap it
 * imposes and the domains it imposes it on — exactly the failures
 * `validatorDomainRatings` lowers a domain for, using the same failure
 * semantics ({@link automatedVerdicts}), so the breakdown and the rating can never
 * disagree. A point excluded from scoring (an erratum) never caps anything and is
 * omitted; so is a failure of a point the case no longer declares. Ordered by the
 * checklist's own order.
 */
export function validatorFailures(
  items: readonly ReviewItemSummary[],
  debugScripts: readonly DebugScriptResult[],
): ValidatorFailure[] {
  const failed = new Set(
    automatedVerdicts(debugScripts)
      .filter((v) => v.status === "fail")
      .map((v) => v.id),
  );
  const out: ValidatorFailure[] = [];
  for (const item of items) {
    if (item.scored === false) continue;
    const subItems = item.subItems ?? [];
    if (subItems.length === 0) {
      if (failed.has(item.id) && item.failureCap) {
        out.push({
          id: item.id,
          title: item.title,
          category: "",
          cap: item.failureCap,
          domains: item.domains ?? [],
        });
      }
      continue;
    }
    for (const sub of subItems) {
      if (sub.scored === false) continue;
      const id = subItemVerdictId(item.id, sub.id);
      if (failed.has(id) && sub.failureCap) {
        out.push({
          id,
          title: sub.title,
          category: item.title,
          cap: sub.failureCap,
          domains: sub.domains ?? [],
        });
      }
    }
  }
  return out;
}
