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
