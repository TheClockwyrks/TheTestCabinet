import org.teavm.jso.JSObject

/**
 * The `tasks` object: your task list, which is a DAG rather than a list of lines.
 *
 * One spelling in here is worth reading twice. `updateTask`'s description is a **three-way** edit, and
 * [Patch] says all three without a sentinel: never name it to keep the description you have,
 * [Patch.Clear] to empty it, `Patch.Replace(…)` to replace it.
 */
public class Tasks internal constructor() : ApiObject("tasks") {
    override fun target(): JSObject? = tasksObject()

    /**
     * Add a task to the task DAG and hand back the task budget.
     *
     * @param id The id you choose for it. It is what every other task call takes, and no two tasks may
     *   share one.
     * @param title A short line naming the work.
     * @param description What the work is, at whatever length is useful.
     * @param blockedBy The ids of the tasks that must be done before this one.
     * @return how much of the task budget is now used
     * @throws ToolError `CONFLICT` on a duplicate id or on an edge that would close a cycle.
     */
    public fun addTask(
        id: String,
        title: String,
        description: String? = null,
        blockedBy: List<String>? = null,
    ): TaskUsage {
        val task = ggRecord()
        ggSet(task, "id", ggText(id))
        ggSet(task, "title", ggText(title))
        if (description != null) {
            ggSet(task, "description", ggText(description))
        }
        if (blockedBy != null) {
            ggSet(task, "blockedBy", ggTexts(blockedBy))
        }
        return Read.taskUsage(ggCall("add_task", target(), owner, "addTask", ggArgs(task)))
    }

    /**
     * Revise a task's title, description and/or status: name at least one, and a field you never name
     * is left alone.
     *
     * ```
     * tasks.updateTask("parse", status = TaskStatus.DONE, title = "parse the manifest")
     * ```
     *
     * @param id The task to revise.
     * @param title The title to replace the old one with.
     * @param description The description to replace the old one with, or [Patch.Clear] to leave the
     *   task with none.
     * @param status Where the task now stands.
     * @throws ToolError `NOT_FOUND` for an unknown id.
     */
    public fun updateTask(
        id: String,
        title: String? = null,
        description: Patch<String>? = null,
        status: TaskStatus? = null,
    ) {
        val patch = ggRecord()
        if (title != null) {
            ggSet(patch, "title", ggText(title))
        }
        description?.lower(patch, "description")
        if (status != null) {
            ggSet(patch, "status", ggText(status.wireName))
        }
        ggRun("update_task", target(), owner, "updateTask", ggArgs(ggText(id), patch))
    }

    /**
     * Replace a task's whole blocker set; naming none clears every blocker.
     *
     * @param id The task whose blockers to replace.
     * @param blockedBy The ids of every task that must now be done before it. Naming none clears them
     *   all.
     * @throws ToolError `NOT_FOUND` for an unknown id, and `CONFLICT` when an edge would close a cycle.
     */
    public fun setBlockedBy(id: String, vararg blockedBy: String) {
        ggRun(
            "set_blocked_by",
            target(),
            owner,
            "setBlockedBy",
            ggArgs(ggText(id), ggTexts(blockedBy.asIterable())),
        )
    }

    /**
     * Mark a task done. Tasks it was blocking become actionable once every one of their blockers is
     * done.
     *
     * @param id The task to mark done.
     * @throws ToolError `NOT_FOUND` for an unknown id.
     */
    public fun completeTask(id: String) {
        ggRun("complete_task", target(), owner, "completeTask", ggArgs(ggText(id)))
    }

    /**
     * Remove a task and every blocker edge pointing at it, and hand back the task budget.
     *
     * @param id The task to remove.
     * @return how much of the task budget is now used
     * @throws ToolError `NOT_FOUND` for an unknown id.
     */
    public fun removeTask(id: String): TaskUsage =
        Read.taskUsage(
            ggCall("remove_task", target(), owner, "removeTask", ggArgs(ggText(id))),
        )
}
