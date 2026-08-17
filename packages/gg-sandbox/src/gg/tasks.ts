/**
 * The task list: a directed acyclic graph of work this agent is tracking for itself.
 *
 * A task is lightweight — a title, a description and its blockers — and it is the agent's own note to
 * itself rather than something another agent can be dispatched onto. `gg.board` is the heavyweight
 * unit that can be.
 *
 * Two lowerings live here so a program writes an ordinary object instead of a tagged union. A
 * patch's `description` is a three-way edit: omit it to leave the description alone, pass `null` to
 * clear it, pass a string to replace it. And a status is `in_progress` on this side and `in-progress`
 * across the membrane, because a WIT identifier cannot carry an underscore.
 */

import * as raw from "test-cabinet:gg/tasks";
import type { TaskStatusRaw } from "test-cabinet:gg/tasks";
import type { TextEdit } from "test-cabinet:gg/types";
import { arrayArg, call } from "../internal/errors.js";

/** Where a task stands. */
export type TaskStatus =
  /** Not started. Every task begins here. */
  | "pending"
  /** Being worked on now. */
  | "in_progress"
  /** Finished. Tasks blocked on it become actionable once all their blockers are done. */
  | "done";

/** How much of the run's task budget is used, after the call that returned it. */
export interface TaskUsage {
  /** Tasks currently on the list. */
  count: number;

  /** The most tasks this run allows. */
  maxTasks: number;
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
 * Lower `in_progress` onto the membrane's `in-progress`; the other two arms are identical.
 *
 * @internal
 */
function witStatus(status: TaskStatus | undefined): TaskStatusRaw | undefined {
  if (status === undefined) return undefined;
  return status === "in_progress" ? "in-progress" : status;
}

/**
 * Add a task to the graph.
 *
 * @ggop tasks.add_task
 * @param task The task to add.
 * @param task.id The id chosen for it. It is what every other task call takes, and no two tasks may
 * share one.
 * @param task.title A short line naming the work.
 * @param task.description What the work is, at whatever length is useful.
 * @param task.blockedBy The ids of the tasks that must be done before this one. The default is none.
 * @returns how much of the task budget is used now that the task is on the list.
 * @throws `ApiError` with `conflict` on a duplicate id, or on an edge that would close a cycle.
 */
export function addTask(task: {
  id: string;
  title: string;
  description?: string;
  blockedBy?: string[];
}): TaskUsage {
  return call(() =>
    raw.addTask({
      id: task.id,
      title: task.title,
      description: task.description,
      blockedBy: arrayArg("addTask", "blockedBy", task.blockedBy),
    }),
  );
}

/**
 * Revise a task's title, description or status, at least one of the three.
 *
 * An omitted `description` leaves it alone, `null` clears it, and a string replaces it.
 *
 * @ggop tasks.update_task
 * @param id The task to revise.
 * @param patch The fields to change. At least one is required; an omitted field is left alone.
 * @param patch.title The title to replace the old one with.
 * @param patch.description The description to replace the old one with, or `null` to clear it.
 * @param patch.status Where the task now stands.
 * @throws `ApiError` with `not-found` for an unknown id.
 */
export function updateTask(
  id: string,
  patch: { title?: string; description?: string | null; status?: TaskStatus },
): void {
  call(() =>
    raw.updateTask(id, {
      title: patch.title,
      description: textEdit(patch.description),
      status: witStatus(patch.status),
    }),
  );
}

/**
 * Replace a task's whole blocker set; an empty array clears every blocker.
 *
 * @ggop tasks.set_blocked_by
 * @param id The task whose blockers to replace.
 * @param blockedBy The ids of every task that must now be done before it. An empty array clears them
 * all.
 * @throws `ApiError` with `not-found` for an unknown id, and `conflict` when an edge would close a
 * cycle.
 */
export function setBlockedBy(id: string, blockedBy: string[]): void {
  call(() => raw.setBlockedBy(id, arrayArg("setBlockedBy", "blockedBy", blockedBy)));
}

/**
 * Mark a task done, which makes the tasks it was blocking actionable.
 *
 * A blocked task becomes actionable only once every one of its blockers is done.
 *
 * @ggop tasks.complete_task
 * @param id The task to mark done.
 * @throws `ApiError` with `not-found` for an unknown id.
 */
export function completeTask(id: string): void {
  call(() => raw.completeTask(id));
}

/**
 * Remove a task and every blocker edge pointing at it.
 *
 * @ggop tasks.remove_task
 * @param id The task to remove.
 * @returns how much of the task budget is used now that the task has gone.
 * @throws `ApiError` with `not-found` for an unknown id.
 */
export function removeTask(id: string): TaskUsage {
  return call(() => raw.removeTask(id));
}
