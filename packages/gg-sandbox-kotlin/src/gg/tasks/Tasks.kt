/**
 * The agent's own task list, which is a directed acyclic graph rather than a list of lines.
 *
 * A task is the lightweight unit of work: an id chosen by the caller, a title, and the tasks that
 * must be done first. Nothing dispatches a task and nothing reviews one, which is what separates it
 * from an issue on the board.
 *
 * A revision's description is three-way, and `gg.core.Patch` says all three states without a
 * sentinel: leaving the argument out keeps what is there, `Patch.Clear` empties it, and
 * `Patch.Replace` replaces it.
 *
 * @ggmodule tasks
 */
package gg.tasks

import gg.core.Patch
import gg.core.ApiError
import gg.internal.Read
import gg.internal.ggCall
import gg.internal.ggList
import gg.internal.ggRecord
import gg.internal.ggRun
import gg.internal.ggText
import gg.internal.ggTexts
import gg.internal.lowered


/**
 * Add a task to the graph and hand back the task budget.
 *
 * @ggop tasks.add_task
 * @param id The id chosen for it. Every other task call takes it, and no two tasks may share one.
 * @param title A short line naming the work.
 * @param description What the work is, at whatever length is useful.
 * @param blockedBy The ids of the tasks that must be done before this one.
 * @return how much of the task budget is now used
 * @throws ApiError `CONFLICT` on a duplicate id or on an edge that would close a cycle.
 */
public fun addTask(
    id: String,
    title: String,
    description: String? = null,
    blockedBy: List<String>? = null,
): TaskUsage {
    val task =
        ggRecord()
            .put("id", ggText(id))
            .put("title", ggText(title))
            .put("description", ggText(description))
            .put("blocked-by", if (blockedBy == null) ggList() else ggTexts(blockedBy))
    return Read.taskUsage(ggCall("tasks.add_task", task))
}

/**
 * Revise a task's title, description or status: at least one, and a field left out is left alone.
 *
 * ```
 * gg.tasks.updateTask("parse", status = gg.tasks.TaskStatus.DONE, title = "parse the manifest")
 * ```
 *
 * @ggop tasks.update_task
 * @param id The task to revise.
 * @param title The title to replace the old one with.
 * @param description The description to replace the old one with, or `Patch.Clear` to leave the task
 *   with none.
 * @param status Where the task now stands.
 * @throws ApiError `NOT_FOUND` for an unknown id.
 */
public fun updateTask(
    id: String,
    title: String? = null,
    description: Patch<String>? = null,
    status: TaskStatus? = null,
) {
    val patch =
        ggRecord()
            .put("title", ggText(title))
            .put("description", description.lowered())
            .put("status", ggText(status?.wireName))
    ggRun("tasks.update_task", ggText(id), patch)
}

/**
 * Replace a task's whole blocker set; naming none clears every blocker.
 *
 * @ggop tasks.set_blocked_by
 * @param id The task whose blockers to replace.
 * @param blockedBy The ids of every task that must now be done before it.
 * @throws ApiError `NOT_FOUND` for an unknown id, and `CONFLICT` when an edge would close a cycle.
 */
public fun setBlockedBy(id: String, vararg blockedBy: String) {
    ggRun("tasks.set_blocked_by", ggText(id), ggTexts(blockedBy.asIterable()))
}

/**
 * Mark a task done, making the tasks it blocked actionable once their other blockers are done too.
 *
 * @ggop tasks.complete_task
 * @param id The task to mark done.
 * @throws ApiError `NOT_FOUND` for an unknown id.
 */
public fun completeTask(id: String) {
    ggRun("tasks.complete_task", ggText(id))
}

/**
 * Remove a task and every blocker edge pointing at it.
 *
 * @ggop tasks.remove_task
 * @param id The task to remove.
 * @return how much of the task budget is now used
 * @throws ApiError `NOT_FOUND` for an unknown id.
 */
public fun removeTask(id: String): TaskUsage =
    Read.taskUsage(ggCall("tasks.remove_task", ggText(id)))

/**
 * How much of the run's task budget is used, after the call that returned it.
 *
 * @property count Tasks currently on the list.
 * @property maxTasks The most tasks this run allows.
 */
public data class TaskUsage(val count: Int, val maxTasks: Int)

/**
 * Where a task stands.
 *
 * @property wireName gg's own word for this status, which is what both execution modes report.
 */
public enum class TaskStatus(public val wireName: String) {
    /** Not started. Every task begins here. */
    PENDING("pending"),

    /** Being worked on now. */
    IN_PROGRESS("in-progress"),

    /** Finished. Tasks blocked on it become actionable once all their blockers are done. */
    DONE("done"),
}
