package gg.tasks;

import gg.ApiError;
import gg.ApiErrorCode;
import gg.internal.Coding;
import gg.internal.Read;
import gg.internal.Value;
import java.util.List;

/**
 * A private task list, held as a graph with blocker edges.
 *
 * <p>Small units of this session's own work; nothing is dispatched from it. A task blocked on
 * others becomes actionable when the last of them is done.
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
     * @throws ApiError {@link ApiErrorCode#CONFLICT} on a duplicate id.
     * @ggop tasks.add_task
     */
    public static TaskUsage addTask(String id, String title) {
        return Read.taskUsage(Coding.call("tasks.add_task", task(id, title, null, null)));
    }

    /**
     * Add a task carrying a description as well as a title.
     *
     * @param id The id to file it under. No two tasks may share one.
     * @param title A short line naming the work.
     * @param description What the work is, at whatever length is useful.
     * @return how much of the task budget is now used
     * @throws ApiError {@link ApiErrorCode#CONFLICT} on a duplicate id.
     * @ggop tasks.add_task
     */
    public static TaskUsage addTask(String id, String title, String description) {
        return Read.taskUsage(Coding.call("tasks.add_task", task(id, title, description, null)));
    }

    /**
     * Add a task blocked on others, which have to finish before it becomes actionable.
     *
     * @param id The id to file it under. No two tasks may share one.
     * @param title A short line naming the work.
     * @param description What the work is, at whatever length is useful.
     * @param blockedBy The ids of the tasks that must be done before this one.
     * @return how much of the task budget is now used
     * @throws ApiError {@link ApiErrorCode#CONFLICT} on a duplicate id, or on an edge that would
     *     close a cycle.
     * @ggop tasks.add_task
     */
    public static TaskUsage addTask(String id, String title, String description,
            List<String> blockedBy) {
        return Read.taskUsage(
                Coding.call("tasks.add_task", task(id, title, description, blockedBy)));
    }

    /**
     * Revise a task's title, description or status.
     *
     * <p>The revision is built with {@code Tasks.TaskPatch} and has to carry at least one field; a
     * field it never names is left alone.
     *
     * @param id The task to revise.
     * @param patch The fields to change. It must carry at least one.
     * @throws ApiError {@link ApiErrorCode#NOT_FOUND} for an unknown id.
     * @ggop tasks.update_task
     */
    public static void updateTask(String id, TaskPatch patch) {
        Coding.call("tasks.update_task", Value.of(id), patch.lowered());
    }

    /**
     * Replace a task's whole blocker set; naming none clears every blocker.
     *
     * @param id The task whose blockers to replace.
     * @param blockedBy The ids of every task that must now be done before it. Naming none clears
     *     them all.
     * @throws ApiError {@link ApiErrorCode#NOT_FOUND} for an unknown id, and
     *     {@link ApiErrorCode#CONFLICT} when an edge would close a cycle.
     * @ggop tasks.set_blocked_by
     */
    public static void setBlockedBy(String id, String... blockedBy) {
        Coding.call("tasks.set_blocked_by", Value.of(id), Value.texts(blockedBy));
    }

    /**
     * Mark a task done, which makes the tasks it was blocking actionable.
     *
     * <p>A task becomes actionable when the last of its blockers is done rather than the first.
     *
     * @param id The task to mark done.
     * @throws ApiError {@link ApiErrorCode#NOT_FOUND} for an unknown id.
     * @ggop tasks.complete_task
     */
    public static void completeTask(String id) {
        Coding.call("tasks.complete_task", Value.of(id));
    }

    /**
     * Remove a task and every blocker edge pointing at it.
     *
     * @param id The task to remove.
     * @return how much of the task budget is now used
     * @throws ApiError {@link ApiErrorCode#NOT_FOUND} for an unknown id.
     * @ggop tasks.remove_task
     */
    public static TaskUsage removeTask(String id) {
        return Read.taskUsage(Coding.call("tasks.remove_task", Value.of(id)));
    }

    /** The `task-input` record, as gg's own WIT declares it. */
    private static Value task(String id, String title, String description,
            List<String> blockedBy) {
        return Value.record()
                .put("id", Value.of(id))
                .put("title", Value.of(title))
                .put("description", Value.of(description))
                .put("blocked-by", blockedBy == null ? Value.list() : Value.texts(blockedBy));
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
        IN_PROGRESS("in-progress"),
        /** Finished, which makes the tasks blocked on it actionable. */
        DONE("done");

        private final String wire;

        TaskStatus(String wire) {
            this.wire = wire;
        }

        /**
         * gg's own word for this status.
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
        /** The new title, absent until one is named. */
        private Value title = Value.none();

        /** What to do to the description: keep it, clear it, or set it. */
        private Value description = Value.variant("keep", null);

        /** The new status, absent until one is named. */
        private Value status = Value.none();

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
            this.title = Value.of(title);
            return this;
        }

        /**
         * Replace the task's description.
         *
         * @param description The description to replace the old one with.
         * @return this revision, so calls chain
         */
        public TaskPatch description(String description) {
            this.description = Value.variant("set", Value.of(description));
            return this;
        }

        /**
         * Clear the task's description, leaving it with none.
         *
         * @return this revision, so calls chain
         */
        public TaskPatch clearDescription() {
            this.description = Value.variant("clear", null);
            return this;
        }

        /**
         * Move the task to another status.
         *
         * @param status Where the task now stands.
         * @return this revision, so calls chain
         */
        public TaskPatch status(TaskStatus status) {
            this.status = Value.of(status.wireName());
            return this;
        }

        /** What was set, on its way out. */
        Value lowered() {
            return Value.record()
                    .put("title", title)
                    .put("description", description)
                    .put("status", status);
        }
    }
}
