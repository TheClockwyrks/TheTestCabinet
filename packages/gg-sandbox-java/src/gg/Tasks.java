package gg;

import gg.internal.Read;
import gg.internal.Wire;
import java.util.List;
import org.teavm.jso.JSObject;

/**
 * The {@code tasks} object: your task list, which is a DAG rather than a list of lines.
 *
 * <p>One spelling in here is worth reading twice. {@code updateTask}'s description is a
 * <b>three-way</b> edit, and {@link TaskPatch} says all three without a sentinel: never name it to
 * keep the description you have, {@code clearDescription()} to empty it, {@code description(…)} to
 * replace it.
 */
public final class Tasks extends ApiObject {
    Tasks() {
        super("tasks");
    }

    @Override
    JSObject target() {
        return Wire.tasks();
    }

    /**
     * Add a task to the task DAG and hand back the task budget.
     *
     * @param id The id you choose for it. It is what every other task call takes, and no two tasks
     *     may share one.
     * @param title A short line naming the work.
     * @return how much of the task budget is now used
     * @throws ToolError {@code CONFLICT} on a duplicate id.
     */
    public TaskUsage addTask(String id, String title) {
        return Read.taskUsage(Wire.call("add_task", target(), object(), "addTask",
                Wire.args(task(id, title, null, null))));
    }

    /**
     * Add a task carrying a description as well as a title.
     *
     * @param id The id you choose for it. No two tasks may share one.
     * @param title A short line naming the work.
     * @param description What the work is, at whatever length is useful.
     * @return how much of the task budget is now used
     * @throws ToolError {@code CONFLICT} on a duplicate id.
     */
    public TaskUsage addTask(String id, String title, String description) {
        return Read.taskUsage(Wire.call("add_task", target(), object(), "addTask",
                Wire.args(task(id, title, description, null))));
    }

    /**
     * Add a task that is blocked on others, which must finish before it.
     *
     * @param id The id you choose for it. No two tasks may share one.
     * @param title A short line naming the work.
     * @param description What the work is, at whatever length is useful.
     * @param blockedBy The ids of the tasks that must be done before this one.
     * @return how much of the task budget is now used
     * @throws ToolError {@code CONFLICT} on a duplicate id or on an edge that would close a cycle.
     */
    public TaskUsage addTask(String id, String title, String description,
            List<String> blockedBy) {
        return Read.taskUsage(Wire.call("add_task", target(), object(), "addTask",
                Wire.args(task(id, title, description, blockedBy))));
    }

    /**
     * Revise a task's title, description and/or status.
     *
     * <p>Build the revision with {@link TaskPatch} and supply at least one field; a field you
     * never name is left alone.
     *
     * @param id The task to revise.
     * @param patch The fields to change. Supply at least one; a field it does not carry is left
     *     alone.
     * @throws ToolError {@code NOT_FOUND} for an unknown id.
     */
    public void updateTask(String id, TaskPatch patch) {
        Wire.run("update_task", target(), object(), "updateTask",
                Wire.args(Wire.text(id), patch.lowered()));
    }

    /**
     * Replace a task's whole blocker set; naming none clears every blocker.
     *
     * @param id The task whose blockers to replace.
     * @param blockedBy The ids of every task that must now be done before it. Naming none clears
     *     them all.
     * @throws ToolError {@code NOT_FOUND} for an unknown id, and {@code CONFLICT} when an edge
     *     would close a cycle.
     */
    public void setBlockedBy(String id, String... blockedBy) {
        Wire.run("set_blocked_by", target(), object(), "setBlockedBy",
                Wire.args(Wire.text(id), Wire.texts(blockedBy)));
    }

    /**
     * Mark a task done. Tasks it was blocking become actionable once every one of their blockers
     * is done.
     *
     * @param id The task to mark done.
     * @throws ToolError {@code NOT_FOUND} for an unknown id.
     */
    public void completeTask(String id) {
        Wire.run("complete_task", target(), object(), "completeTask",
                Wire.args(Wire.text(id)));
    }

    /**
     * Remove a task and every blocker edge pointing at it, and hand back the task budget.
     *
     * @param id The task to remove.
     * @return how much of the task budget is now used
     * @throws ToolError {@code NOT_FOUND} for an unknown id.
     */
    public TaskUsage removeTask(String id) {
        return Read.taskUsage(Wire.call("remove_task", target(), object(), "removeTask",
                Wire.args(Wire.text(id))));
    }

    /** The task record the guest's own function takes. */
    private static JSObject task(String id, String title, String description,
            List<String> blockedBy) {
        JSObject task = Wire.object();
        Wire.set(task, "id", Wire.text(id));
        Wire.set(task, "title", Wire.text(title));
        if (description != null) {
            Wire.set(task, "description", Wire.text(description));
        }
        if (blockedBy != null) {
            Wire.set(task, "blockedBy", Wire.texts(blockedBy));
        }
        return task;
    }
}
