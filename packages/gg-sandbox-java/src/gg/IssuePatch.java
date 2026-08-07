package gg;

import gg.internal.Wire;
import org.teavm.jso.JSObject;

/**
 * The fields an issue revision may change, built a call at a time: supply at least one, and a
 * field you never name is left alone.
 *
 * <p>Two of them are <b>three-way</b>, which is why each has a clearing method beside its setter:
 * never naming {@code description} keeps it and {@link #clearDescription} empties it, and never
 * naming the epic leaves the grouping alone while {@link #clearEpic} detaches the issue from the
 * epic it has.
 */
public final class IssuePatch {
    private final JSObject patch = Wire.object();

    /** A revision that changes nothing yet. */
    public IssuePatch() {
    }

    /**
     * Replace the issue's title.
     *
     * @param title The title to replace the old one with.
     * @return this revision, so calls chain
     */
    public IssuePatch title(String title) {
        Wire.set(patch, "title", Wire.text(title));
        return this;
    }

    /**
     * Replace the issue's description.
     *
     * @param description The description to replace the old one with.
     * @return this revision, so calls chain
     */
    public IssuePatch description(String description) {
        Wire.set(patch, "description", Wire.text(description));
        return this;
    }

    /**
     * Clear the issue's description, leaving it with none.
     *
     * @return this revision, so calls chain
     */
    public IssuePatch clearDescription() {
        Wire.clear(patch, "description");
        return this;
    }

    /**
     * Replace what the issue covers.
     *
     * @param inScope The scope statement to replace the old one with.
     * @return this revision, so calls chain
     */
    public IssuePatch inScope(String inScope) {
        Wire.set(patch, "inScope", Wire.text(inScope));
        return this;
    }

    /**
     * Replace what the issue deliberately does not cover.
     *
     * @param outOfScope The non-scope statement to replace the old one with.
     * @return this revision, so calls chain
     */
    public IssuePatch outOfScope(String outOfScope) {
        Wire.set(patch, "outOfScope", Wire.text(outOfScope));
        return this;
    }

    /**
     * Replace what must be true for the issue to be done.
     *
     * @param completionCriteria The completion criteria to replace the old ones with.
     * @return this revision, so calls chain
     */
    public IssuePatch completionCriteria(String completionCriteria) {
        Wire.set(patch, "completionCriteria", Wire.text(completionCriteria));
        return this;
    }

    /**
     * Move the issue to another status.
     *
     * @param status Where the issue now stands.
     * @return this revision, so calls chain
     */
    public IssuePatch status(IssueStatus status) {
        Wire.set(patch, "status", Wire.text(status.wireName()));
        return this;
    }

    /**
     * Regroup the issue under another epic.
     *
     * @param epicId The epic to regroup it under.
     * @return this revision, so calls chain
     */
    public IssuePatch epic(String epicId) {
        Wire.set(patch, "epicId", Wire.text(epicId));
        return this;
    }

    /**
     * Detach the issue from the epic it has, leaving it ungrouped.
     *
     * @return this revision, so calls chain
     */
    public IssuePatch clearEpic() {
        Wire.clear(patch, "epicId");
        return this;
    }

    /** What was set, on its way out. */
    JSObject lowered() {
        return patch;
    }
}
