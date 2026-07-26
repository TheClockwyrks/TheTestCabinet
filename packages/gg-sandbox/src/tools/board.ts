/**
 * The `board` family: the epic/issue board.
 *
 * An issue is the heavyweight unit of work — scope, non-scope and completion criteria are exactly
 * what a delegated child agent is briefed from — which is why `createIssue` asks for more than
 * `addTask` does.
 *
 * Three lowerings live here, all of the same kind: a model writes `undefined` / `null` / a value and
 * the wrapper turns that into the membrane's tagged variant. `description` is a three-way text edit,
 * `epicId` is a three-way epic assignment (omit to leave the grouping alone, `null` to ungroup, an
 * id to regroup), and a status is gg's `in_progress` on this side and `in-progress` on the other.
 */

import * as raw from "test-cabinet:gg/board";
import type { EpicAssignment, IssueStatusRaw } from "test-cabinet:gg/board";
import type { TextEdit } from "test-cabinet:gg/types";
import { call, list } from "../errors.js";
import type { BoardUsage, CompletionReport, IssueStatus } from "../types.js";

/** Lower the `undefined` / `null` / string sentinel onto the membrane's three-way text edit. */
function textEdit(value: string | null | undefined): TextEdit {
  if (value === undefined) return { tag: "keep" };
  if (value === null) return { tag: "clear" };
  return { tag: "set", val: value };
}

/** Lower the `undefined` / `null` / id sentinel onto the membrane's epic assignment. */
function epicEdit(value: string | null | undefined): EpicAssignment {
  if (value === undefined) return { tag: "keep" };
  if (value === null) return { tag: "ungroup" };
  return { tag: "set", val: value };
}

/** Lower gg's `in_progress` onto the membrane's `in-progress`; the other two arms are identical. */
function witStatus(status: IssueStatus | undefined): IssueStatusRaw | undefined {
  if (status === undefined) return undefined;
  return status === "in_progress" ? "in-progress" : status;
}

/**
 * Create an epic to group related issues, and return the board budget. Throws `conflict` on a
 * duplicate id.
 */
export function createEpic(epic: { id: string; title: string; description: string }): BoardUsage {
  return call(() => raw.createEpic(epic));
}

/**
 * Create a self-contained, dispatchable issue and return the board budget. `inScope`, `outOfScope`
 * and `completionCriteria` are what a child agent is briefed from, so write them for a reader with
 * no other context. `blockedBy` defaults to none; `epicId` groups the issue under an existing epic.
 * Throws `conflict` on a duplicate id or a blocker edge that would close a cycle.
 */
export function createIssue(issue: {
  id: string;
  title: string;
  description?: string;
  inScope: string;
  outOfScope: string;
  completionCriteria: string;
  blockedBy?: string[];
  epicId?: string;
}): BoardUsage {
  return call(() =>
    raw.createIssue({
      id: issue.id,
      title: issue.title,
      description: issue.description,
      inScope: issue.inScope,
      outOfScope: issue.outOfScope,
      completionCriteria: issue.completionCriteria,
      blockedBy: list("createIssue", "blockedBy", issue.blockedBy),
      epicId: issue.epicId,
    }),
  );
}

/**
 * Revise an issue; supply at least one field. An omitted field is left alone, `description: null`
 * clears the description, and `epicId: null` detaches the issue from its epic. Throws `not-found`
 * for an unknown id.
 */
export function updateIssue(
  id: string,
  patch: {
    title?: string;
    description?: string | null;
    inScope?: string;
    outOfScope?: string;
    completionCriteria?: string;
    status?: IssueStatus;
    epicId?: string | null;
  },
): void {
  call(() =>
    raw.updateIssue(id, {
      title: patch.title,
      description: textEdit(patch.description),
      inScope: patch.inScope,
      outOfScope: patch.outOfScope,
      completionCriteria: patch.completionCriteria,
      status: witStatus(patch.status),
      epic: epicEdit(patch.epicId),
    }),
  );
}

/**
 * Replace an issue's whole blocker set; an empty array clears every blocker. Throws `not-found` for
 * an unknown id and `conflict` when an edge would close a cycle.
 */
export function setIssueBlockedBy(id: string, blockedBy: string[]): void {
  call(() => raw.setIssueBlockedBy(id, list("setIssueBlockedBy", "blockedBy", blockedBy)));
}

/**
 * Mark an issue done and report how it was accepted. With Code Reviews enabled this first runs a
 * gating reviewer subagent, and possibly a fix loop, so it is the one cheap-looking call that can
 * take minutes. Throws `not-found` for an unknown id.
 */
export function completeIssue(id: string): CompletionReport {
  return call(() => raw.completeIssue(id));
}

/**
 * Remove an epic, keeping its issues and ungrouping them, and return the board budget. Throws
 * `not-found` for an unknown id.
 */
export function removeEpic(id: string): BoardUsage {
  return call(() => raw.removeEpic(id));
}

/**
 * Remove an issue and every blocker edge pointing at it, and return the board budget. Throws
 * `not-found` for an unknown id.
 */
export function removeIssue(id: string): BoardUsage {
  return call(() => raw.removeIssue(id));
}
