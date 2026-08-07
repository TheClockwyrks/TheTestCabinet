package gg;

import gg.internal.Wire;
import org.teavm.jso.JSObject;

/**
 * The fields a task revision may change, built a call at a time: supply at least one, and a field
 * you never name is left alone.
 *
 * <p>The description is a <b>three-way</b> edit, which is why it has two methods rather than one:
 * never naming it keeps what is there, {@link #description} replaces it, and
 * {@link #clearDescription} empties it.
 *
 * <pre>{@code
 * tasks.updateTask("parse", new TaskPatch().status(TaskStatus.DONE).title("parse the manifest"));
 * }</pre>
 */
public final class TaskPatch {
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
