package gg.tasks;

import gg.ToolError;
import gg.ToolErrorCode;
import gg.internal.Read;
import gg.internal.Wire;
import java.util.List;
import org.teavm.jso.JSObject;

/**
 * A private task list, held as a graph with blocker edges.
 *
 * <p>Small units of one agent's own work. Nobody dispatches from it — the board is where other
 * agents pick work up — and a task blocked on others becomes actionable when the last of them is
 * done.
 *
 * @ggmodule tasks
 */
public final class Tasks {
    private Tasks() {
    }

    /**
     * Add a task to the list, and hand back what the task budget now stands at.
     *
     * @param id The id to file it under. It is what every other task call takes, and no two tasks
     *     may share one.
     * @param title A short line naming the work.
     * @return how much of the task budget is now used
     * @throws ToolError {@link ToolErrorCode#CONFLICT} on a duplicate id.
     * @ggop tasks.add_task
     */
    public static TaskUsage addTask(String id, String title) {
        return Read.taskUsage(Wire.call("add_task", Wire.tasks(), "tasks", "addTask",
                Wire.args(task(id, title, null, null))));
    }

    /**
     * Add a task carrying a description as well as a title.
     *
     * @param id The id to file it under. No two tasks may share one.
     * @param title A short line naming the work.
     * @param description What the work is, at whatever length is useful.
     * @return how much of the task budget is now used
     * @throws ToolError {@link ToolErrorCode#CONFLICT} on a duplicate id.
     * @ggop tasks.add_task
     */
    public static TaskUsage addTask(String id, String title, String description) {
        return Read.taskUsage(Wire.call("add_task", Wire.tasks(), "tasks", "addTask",
                Wire.args(task(id, title, description, null))));
    }

    /**
     * Add a task blocked on others, which have to finish before it becomes actionable.
     *
     * @param id The id to file it under. No two tasks may share one.
     * @param title A short line naming the work.
     * @param description What the work is, at whatever length is useful.
     * @param blockedBy The ids of the tasks that must be done before this one.
     * @return how much of the task budget is now used
     * @throws ToolError {@link ToolErrorCode#CONFLICT} on a duplicate id, or on an edge that would
     *     close a cycle.
     * @ggop tasks.add_task
     */
    public static TaskUsage addTask(String id, String title, String description,
            List<String> blockedBy) {
        return Read.taskUsage(Wire.call("add_task", Wire.tasks(), "tasks", "addTask",
                Wire.args(task(id, title, description, blockedBy))));
    }

    /**
     * Revise a task's title, description or status.
     *
     * <p>The revision is built with {@code Tasks.TaskPatch} and has to carry at least one field; a
     * field it never names is left alone.
     *
     * @param id The task to revise.
     * @param patch The fields to change. It must carry at least one.
     * @throws ToolError {@link ToolErrorCode#NOT_FOUND} for an unknown id.
     * @ggop tasks.update_task
     */
    public static void updateTask(String id, TaskPatch patch) {
        Wire.run("update_task", Wire.tasks(), "tasks", "updateTask",
                Wire.args(Wire.text(id), patch.lowered()));
    }

    /**
     * Replace a task's whole blocker set; naming none clears every blocker.
     *
     * @param id The task whose blockers to replace.
     * @param blockedBy The ids of every task that must now be done before it. Naming none clears
     *     them all.
     * @throws ToolError {@link ToolErrorCode#NOT_FOUND} for an unknown id, and
     *     {@link ToolErrorCode#CONFLICT} when an edge would close a cycle.
     * @ggop tasks.set_blocked_by
     */
    public static void setBlockedBy(String id, String... blockedBy) {
        Wire.run("set_blocked_by", Wire.tasks(), "tasks", "setBlockedBy",
                Wire.args(Wire.text(id), Wire.texts(blockedBy)));
    }

    /**
     * Mark a task done, which makes the tasks it was blocking actionable.
     *
     * <p>A task becomes actionable when the last of its blockers is done rather than the first.
     *
     * @param id The task to mark done.
     * @throws ToolError {@link ToolErrorCode#NOT_FOUND} for an unknown id.
     * @ggop tasks.complete_task
     */
    public static void completeTask(String id) {
        Wire.run("complete_task", Wire.tasks(), "tasks", "completeTask",
                Wire.args(Wire.text(id)));
    }

    /**
     * Remove a task and every blocker edge pointing at it.
     *
     * @param id The task to remove.
     * @return how much of the task budget is now used
     * @throws ToolError {@link ToolErrorCode#NOT_FOUND} for an unknown id.
     * @ggop tasks.remove_task
     */
    public static TaskUsage removeTask(String id) {
        return Read.taskUsage(Wire.call("remove_task", Wire.tasks(), "tasks", "removeTask",
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

    // -------------------------------------------------------------------------------------------
    // The types the task list takes and hands back
    // -------------------------------------------------------------------------------------------

    /**
     * How much of the run's task budget is used, after the call that returned it.
     *
     * @param count Tasks currently on the list.
     * @param maxTasks The most tasks this run allows.
     */
    public record TaskUsage(int count, int maxTasks) {
    }

    /** Where a task stands. */
    public enum TaskStatus {
        /** Not started, which is where every task begins. */
        PENDING("pending"),
        /** Being worked on now. */
        IN_PROGRESS("in_progress"),
        /** Finished, which makes the tasks blocked on it actionable. */
        DONE("done");

        private final String wire;

        TaskStatus(String wire) {
            this.wire = wire;
        }

        /**
         * gg's own word for this status, which is what both execution modes report.
         *
         * @return the name gg uses on the wire
         */
        public String wireName() {
            return wire;
        }
    }

    /**
     * The fields a task revision changes, built a call at a time.
     *
     * <p>A revision has to carry at least one field, and a field it never names is left alone. The
     * description is a three-way edit, which is why it has two methods rather than one: never naming
     * it keeps what is there, {@code description} replaces it, and {@code clearDescription} empties
     * it.
     *
     * <pre>{@code
     * Tasks.updateTask("parse", new Tasks.TaskPatch().status(Tasks.TaskStatus.DONE));
     * }</pre>
     */
    public static final class TaskPatch {
        private final JSObject patch = Wire.object();

        /** A revision that changes nothing yet. */
        public TaskPatch() {
        }

        /**
         * Replace the task's title.
         *
         * @param title The title to replace the old one with.
         * @return this revision, so calls chain
         */
        public TaskPatch title(String title) {
            Wire.set(patch, "title", Wire.text(title));
            return this;
        }

        /**
         * Replace the task's description.
         *
         * @param description The description to replace the old one with.
         * @return this revision, so calls chain
         */
        public TaskPatch description(String description) {
            Wire.set(patch, "description", Wire.text(description));
            return this;
        }

        /**
         * Clear the task's description, leaving it with none.
         *
         * @return this revision, so calls chain
         */
        public TaskPatch clearDescription() {
            Wire.clear(patch, "description");
            return this;
        }

        /**
         * Move the task to another status.
         *
         * @param status Where the task now stands.
         * @return this revision, so calls chain
         */
        public TaskPatch status(TaskStatus status) {
            Wire.set(patch, "status", Wire.text(status.wireName()));
            return this;
        }

        /** What was set, on its way out. */
        JSObject lowered() {
            return patch;
        }
    }
}
