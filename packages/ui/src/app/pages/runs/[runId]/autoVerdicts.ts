import type { RunRecord } from "@test-cabinet/run-record";
import type { ReviewItem, VerdictStatus } from "../../../../client/types";
import { verdictIdsForItem } from "../../../data/ratings";

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
  for (const script of run.validation.debugScripts ?? []) {
    for (const v of script.verdicts) {
      // The reviewer's note is left blank: a verdict's proof is its assertions,
      // shown in the automated-validation list, not stuffed into the note field.
      map.set(v.id, { status: v.pass ? "pass" : "fail", note: "" });
    }
  }
  return map;
}

/**
 * The verdict ids whose draft answer *differs* from what this run's validation
 * decided — the reviewer's overrides, and exactly the set a restore can put back.
 *
 * Only declared points are considered (an auto verdict for an item the case no
 * longer declares is not offered), and only ones validation actually decided: a
 * point it left to the reviewer — a subjective item, or a check whose precondition
 * went unmet — has no machine value to restore and is never touched. A note is
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
