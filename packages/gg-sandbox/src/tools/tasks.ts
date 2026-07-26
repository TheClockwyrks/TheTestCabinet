/**
 * The `tasks` family: the task DAG.
 *
 * Two lowerings live here, both so a model writes ordinary TypeScript instead of a tagged union.
 * `description` on a patch is a three-way edit — omit it to leave the description alone, pass `null`
 * to clear it, pass a string to replace it — which the membrane models as a `text-edit` variant.
 * And a status is gg's `in_progress` on this side and the membrane's `in-progress` on the other,
 * because WIT identifiers cannot contain an underscore; a model should never see that seam.
 */

import * as raw from "test-cabinet:gg/tasks";
import type { TaskStatusRaw } from "test-cabinet:gg/tasks";
import type { TextEdit } from "test-cabinet:gg/types";
import { call, list } from "../errors.js";
import type { TaskStatus, TaskUsage } from "../types.js";

/** Lower the `undefined` / `null` / string sentinel onto the membrane's three-way text edit. */
function textEdit(value: string | null | undefined): TextEdit {
  if (value === undefined) return { tag: "keep" };
  if (value === null) return { tag: "clear" };
  return { tag: "set", val: value };
}

/** Lower gg's `in_progress` onto the membrane's `in-progress`; the other two arms are identical. */
function witStatus(status: TaskStatus | undefined): TaskStatusRaw | undefined {
  if (status === undefined) return undefined;
  return status === "in_progress" ? "in-progress" : status;
}

/**
 * Add a task to the task DAG and return the task budget. `blockedBy` names the tasks that must
 * finish before this one and defaults to none. Throws `conflict` on a duplicate id or on an edge
 * that would close a cycle.
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
      blockedBy: list("addTask", "blockedBy", task.blockedBy),
    }),
  );
}

/**
 * Revise a task's title, description and/or status; supply at least one. An omitted `description`
 * leaves it alone, `null` clears it, and a string replaces it. Throws `not-found` for an unknown id.
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
 * Replace a task's whole blocker set; an empty array clears every blocker. Throws `not-found` for an
 * unknown id and `conflict` when an edge would close a cycle.
 */
export function setBlockedBy(id: string, blockedBy: string[]): void {
  call(() => raw.setBlockedBy(id, list("setBlockedBy", "blockedBy", blockedBy)));
}

/**
 * Mark a task done. Tasks it was blocking become actionable once every one of their blockers is
 * done. Throws `not-found` for an unknown id.
 */
export function completeTask(id: string): void {
  call(() => raw.completeTask(id));
}

/**
 * Remove a task and every blocker edge pointing at it, and return the task budget. Throws
 * `not-found` for an unknown id.
 */
export function removeTask(id: string): TaskUsage {
  return call(() => raw.removeTask(id));
}
