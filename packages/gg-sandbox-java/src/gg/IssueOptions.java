package gg;

import gg.internal.Wire;
import org.teavm.jso.JSObject;

/**
 * The parts of a new issue you may leave out, built a call at a time.
 *
 * <p>An issue's required parts are arguments of {@code project.createIssue} itself; these four are
 * the ones a program may say nothing about, and Java's answer to four optional fields is an object
 * whose setters chain rather than sixteen overloads.
 *
 * <pre>{@code
 * project.createIssue("parse the manifest", inScope, outOfScope, criteria, "builder",
 *         new IssueOptions().epic("AUTH").reviewers("reviewer"));
 * }</pre>
 */
public final class IssueOptions {
    private final JSObject options = Wire.object();

    /** An issue with none of the optional parts filled in. */
    public IssueOptions() {
    }

    /**
     * Say what the work is, at whatever length is useful.
     *
     * @param description What the work is. Written for a child agent with no other context.
     * @return these options, so calls chain
     */
    public IssueOptions description(String description) {
        Wire.set(options, "description", Wire.text(description));
        return this;
    }

    /**
     * Block the issue on others, which must be done before it.
     *
     * @param blockedBy The ids of every issue that must be done before this one.
     * @return these options, so calls chain
     */
    public IssueOptions blockedBy(String... blockedBy) {
        Wire.set(options, "blockedBy", Wire.texts(blockedBy));
        return this;
    }

    /**
     * Group the issue under an existing epic, which is also what its id is numbered from.
     *
     * @param epicId The id of an existing epic to group it under.
     * @return these options, so calls chain
     */
    public IssueOptions epic(String epicId) {
        Wire.set(options, "epicId", Wire.text(epicId));
        return this;
    }

    /**
     * Name the agents that must approve the work.
     *
     * @param reviewers The agents that must approve the work, from the ones you may spawn.
     *     Required when this run's reviewers feature is on.
     * @return these options, so calls chain
     */
    public IssueOptions reviewers(String... reviewers) {
        Wire.set(options, "reviewers", Wire.texts(reviewers));
        return this;
    }

    /** What was set, on its way out. */
    JSObject lowered() {
        return options;
    }
}
