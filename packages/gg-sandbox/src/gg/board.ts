/**
 * The epic and issue board, shared by every agent in the run.
 *
 * An issue is the heavyweight unit of work: its scope, its non-scope and its completion criteria are
 * exactly what a delegated child agent is briefed from, which is why creating one asks for more than
 * adding a task does. Each issue is worked in its own copy of the workspace and merged back once it
 * is accepted.
 *
 * Three lowerings live here, all of the same shape: a program writes `undefined`, `null` or a value,
 * and the wrapper turns that into the membrane's tagged variant.
 */

import * as raw from "test-cabinet:gg/board";
import type { EpicAssignment, IssueStatusRaw } from "test-cabinet:gg/board";
import type { TextEdit } from "test-cabinet:gg/types";
import { arrayArg, call } from "../internal/errors.js";

/** Where an issue stands. */
export type IssueStatus =
  /** Not started, and dispatchable once its blockers are done. */
  | "open"
  /** Dispatched, with its assigned agent working on it. */
  | "in_progress"
  /** Finished and, where this run requires reviewers, approved. */
  | "done";

/** How much of the run's board budget is used, after the call that returned it. */
export interface BoardUsage {
  /** Epics currently on the board. */
  epics: number;

  /** The most epics this run allows. */
  maxEpics: number;

  /** Issues currently on the board. */
  issues: number;

  /** The most issues this run allows. */
  maxIssues: number;
}

/** An epic that was just created: the id its prefix resolved to, and the board budget. */
export interface EpicCreated {
  /**
   * The epic's id: the prefix that was given, upper-cased, so `auth` becomes `AUTH`.
   *
   * Issues are grouped under it by this id, and are numbered from it as `AUTH-1`, `AUTH-2`.
   */
  id: string;

  /** How much of the board budget is used. */
  board: BoardUsage;
}

/** An issue that was just created: the id the board assigned it, and the board budget. */
export interface IssueCreated {
  /**
   * The id the board assigned, such as `AUTH-1`. It is not chosen by the caller.
   *
   * Keeping it is what makes a later issue blockable on this one, or waitable.
   */
  id: string;

  /** How much of the board budget is used. */
  board: BoardUsage;

  /**
   * Register a wait on this issue, with its id already supplied.
   *
   * `gg.board.waitForIssue` for the common case where the issue just created is in hand.
   *
   * @ggop board.wait_for_issue
   * @returns gg's acknowledgement that the wait is registered.
   * @throws `ToolError` with `not-found` when the board no longer holds the issue, and
   * `invalid-argument` where it is the issue this agent was itself assigned.
   */
  wait(): string;
}

/**
 * Dress a created issue in the method its own id makes possible.
 *
 * The record crosses the membrane as data, so the method is attached here rather than declared on a
 * class: nothing in a program ever constructs one of these, and a constructible declaration would be
 * one inviting it to.
 *
 * @internal
 */
function created(issue: raw.IssueCreated): IssueCreated {
  return {
    id: issue.id,
    board: issue.board,
    wait(): string {
      return waitForIssue(issue.id);
    },
  };
}

/**
 * Lower the `undefined` / `null` / string sentinel onto the membrane's three-way text edit.
 *
 * @internal
 */
function textEdit(value: string | null | undefined): TextEdit {
  if (value === undefined) return { tag: "keep" };
  if (value === null) return { tag: "clear" };
  return { tag: "set", val: value };
}

/**
 * Lower the `undefined` / `null` / id sentinel onto the membrane's epic assignment.
 *
 * @internal
 */
function epicEdit(value: string | null | undefined): EpicAssignment {
  if (value === undefined) return { tag: "keep" };
  if (value === null) return { tag: "ungroup" };
  return { tag: "set", val: value };
}

/**
 * Lower `in_progress` onto the membrane's `in-progress`; the other two arms are identical.
 *
 * @internal
 */
function witStatus(status: IssueStatus | undefined): IssueStatusRaw | undefined {
  if (status === undefined) return undefined;
  return status === "in_progress" ? "in-progress" : status;
}

/**
 * Create an epic to group related issues under one prefix.
 *
 * The prefix is 3 to 6 letters; upper-cased it becomes the epic's id and the stem its issues are
 * numbered from, so a prefix of `auth` gives `AUTH-1`, `AUTH-2` and so on.
 *
 * @ggop board.create_epic
 * @param epic The epic to create.
 * @param epic.prefix 3 to 6 letters naming it. Upper-cased, it becomes the epic's id and the stem its
 * issues are numbered from.
 * @param epic.title A short line naming the body of work.
 * @param epic.description What the epic covers, for a reader who has not seen its issues.
 * @returns the id the prefix resolved to, and how much of the board budget is now used.
 * @throws `ToolError` with `invalid-argument` when the prefix is not 3 to 6 letters, and `conflict`
 * when another epic already holds it.
 */
export function createEpic(epic: { prefix: string; title: string; description: string }): EpicCreated {
  return call(() => raw.createEpic(epic));
}

/**
 * Create a self-contained, dispatchable issue and hand back the id the board assigned it.
 *
 * The id is the board's rather than the caller's: it is numbered under its epic's prefix, or under
 * `ISSUE` when it has no epic. `inScope`, `outOfScope` and `completionCriteria` are what a child
 * agent is briefed from, so they are worth writing for a reader with no other context. `agent` names
 * the agent the issue is dispatched to and must be one this agent may spawn; `reviewers` names the
 * agents that must approve the work, from that same set, and is required where this run's reviewers
 * feature is on.
 *
 * @ggop board.create_issue
 * @param issue The issue to create.
 * @param issue.title A short line naming the work.
 * @param issue.description What the work is, written for a child agent with no other context.
 * @param issue.inScope What the issue covers, precisely. Part of the brief a child agent is given.
 * @param issue.outOfScope What the issue deliberately does not cover, so the work stops where it was
 * meant to.
 * @param issue.completionCriteria What must be true for the issue to be done. It is what a reviewer
 * checks the work against.
 * @param issue.blockedBy The ids of every issue that must be done before this one. The default is
 * none.
 * @param issue.epicId The id of an existing epic to group it under. Omitting it leaves the issue
 * ungrouped and numbered under `ISSUE`.
 * @param issue.agent The agent the issue is dispatched to. It must be one this agent may spawn.
 * @param issue.reviewers The agents that must approve the work, from that same set. Required where
 * this run's reviewers feature is on.
 * @returns the id the board assigned, and how much of the board budget is now used.
 * @throws `ToolError` with `invalid-argument` when `agent` or a reviewer is not assignable, and
 * `conflict` on a blocker edge that would close a cycle.
 */
export function createIssue(issue: {
  title: string;
  description?: string;
  inScope: string;
  outOfScope: string;
  completionCriteria: string;
  blockedBy?: string[];
  epicId?: string;
  agent: string;
  reviewers?: string[];
}): IssueCreated {
  return created(
    call(() =>
      raw.createIssue({
        title: issue.title,
        description: issue.description,
        inScope: issue.inScope,
        outOfScope: issue.outOfScope,
        completionCriteria: issue.completionCriteria,
        blockedBy: arrayArg("createIssue", "blockedBy", issue.blockedBy),
        epicId: issue.epicId,
        agent: issue.agent,
        reviewers: arrayArg("createIssue", "reviewers", issue.reviewers),
      }),
    ),
  );
}

/**
 * Revise an issue, changing at least one of its fields.
 *
 * An omitted field is left alone, `description: null` clears the description, and `epicId: null`
 * detaches the issue from its epic.
 *
 * @ggop board.update_issue
 * @param id The issue to revise.
 * @param patch The fields to change. At least one is required; an omitted field is left alone.
 * @param patch.title The title to replace the old one with.
 * @param patch.description The description to replace the old one with, or `null` to clear it.
 * @param patch.inScope The scope statement to replace the old one with.
 * @param patch.outOfScope The non-scope statement to replace the old one with.
 * @param patch.completionCriteria The completion criteria to replace the old ones with.
 * @param patch.status Where the issue now stands.
 * @param patch.epicId The epic to regroup it under, or `null` to detach it from the one it has.
 * @throws `ToolError` with `not-found` for an unknown id.
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
 * Replace an issue's whole blocker set; an empty array clears every blocker.
 *
 * @ggop board.set_issue_blocked_by
 * @param id The issue whose blockers to replace.
 * @param blockedBy The ids of every issue that must now be done before it. An empty array clears them
 * all.
 * @throws `ToolError` with `not-found` for an unknown id, and `conflict` when an edge would close a
 * cycle.
 */
export function setIssueBlockedBy(id: string, blockedBy: string[]): void {
  call(() => raw.setIssueBlockedBy(id, arrayArg("setIssueBlockedBy", "blockedBy", blockedBy)));
}

/**
 * Remove an epic, keeping its issues and ungrouping them.
 *
 * @ggop board.remove_epic
 * @param id The epic to remove.
 * @returns how much of the board budget is used now that the epic has gone.
 * @throws `ToolError` with `not-found` for an unknown id.
 */
export function removeEpic(id: string): BoardUsage {
  return call(() => raw.removeEpic(id));
}

/**
 * Remove an issue and every blocker edge pointing at it.
 *
 * @ggop board.remove_issue
 * @param id The issue to remove.
 * @returns how much of the board budget is used now that the issue has gone.
 * @throws `ToolError` with `not-found` for an unknown id.
 */
export function removeIssue(id: string): BoardUsage {
  return call(() => raw.removeIssue(id));
}

/**
 * Register a wait on an issue, to be served after the program ends, and acknowledge it at once.
 *
 * Nothing blocks inside the program: the wait is recorded and the rest of the program still runs. The
 * suspension happens between turns, freeing this agent's slot for others until the issue is terminal
 * — done, or failed if its assigned agent could not complete it — and the session resumes on the next
 * turn. It is how the next turn's work is sequenced behind an issue it depends on.
 *
 * @ggop board.wait_for_issue
 * @param id The issue to wait on. It may not be the issue this agent was assigned.
 * @returns gg's acknowledgement that the wait is registered.
 * @throws `ToolError` with `not-found` for an unknown id, and `invalid-argument` for the issue this
 * agent was itself assigned.
 */
export function waitForIssue(id: string): string {
  return call(() => raw.waitForIssue(id));
}
