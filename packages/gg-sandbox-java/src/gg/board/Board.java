package gg.board;

import gg.FunctionSummary;
import gg.ToolError;
import gg.ToolErrorCode;
import gg.internal.Read;
import gg.internal.Wire;
import java.util.List;
import org.teavm.jso.JSObject;

/**
 * The epic and issue board, on which work is decomposed into dispatchable units.
 *
 * <p>An issue is heavyweight and self-contained: it says what is in scope, what is not, and how it
 * will be judged done, and gg dispatches it to the agent it names. That is what makes it different
 * from a task, which is a note an agent keeps for itself.
 *
 * @ggmodule board
 */
public final class Board {
    private Board() {
    }

    /**
     * List the functions this module offers, each with a one-line summary.
     *
     * <p>Only the functions this run actually bound are returned, so the directory never names a
     * call a program cannot make. One function's full signature, argument descriptions and types
     * are opened as a view with {@code Views.openDocsView}.
     *
     * @return the functions this module really bound, each with its one-line summary
     * @ggmeta list
     */
    public static List<FunctionSummary> list() {
        return Read.functionSummaries(
                Wire.call("list", Wire.project(), "project", "list", Wire.args()));
    }

    /**
     * Create an epic to group related issues under one prefix.
     *
     * <p>The prefix, upper-cased, becomes the epic's id and the stem its issues are numbered from: a
     * prefix of {@code auth} gives {@code AUTH-1}, {@code AUTH-2}, and so on.
     *
     * @param prefix Three to six letters naming it, which upper-cased become its id.
     * @param title A short line naming the body of work.
     * @param description What the epic covers, for a reader who has not seen its issues.
     * @return the epic's id, and how much of the board budget is now used
     * @throws ToolError {@link ToolErrorCode#INVALID_ARGUMENT} when the prefix is not three to six
     *     letters, and {@link ToolErrorCode#CONFLICT} when another epic already holds it.
     * @ggop board.create_epic
     */
    public static EpicCreated createEpic(String prefix, String title, String description) {
        JSObject epic = Wire.object();
        Wire.set(epic, "prefix", Wire.text(prefix));
        Wire.set(epic, "title", Wire.text(title));
        Wire.set(epic, "description", Wire.text(description));
        return Read.epicCreated(Wire.call("create_epic", Wire.project(), "project", "createEpic",
                Wire.args(epic)));
    }

    /**
     * Create a self-contained, dispatchable issue, and hand back the id the board assigned it.
     *
     * <p>The id is numbered under its epic's prefix, or under {@code ISSUE} where it has no epic, and
     * is the board's to choose rather than the caller's — so the returned one is what blocks a later
     * issue on this one or waits for it.
     *
     * @param title A short line naming the work.
     * @param inScope What the issue covers, precisely. Part of the brief a child agent is given.
     * @param outOfScope What the issue deliberately does not cover, so the work stops where it was
     *     meant to.
     * @param completionCriteria What must be true for the issue to be done, which is what a reviewer
     *     checks the work against.
     * @param agent The agent the issue is dispatched to. It must be one this agent may spawn.
     * @return the id the board assigned, and how much of the board budget is now used
     * @throws ToolError {@link ToolErrorCode#INVALID_ARGUMENT} when {@code agent} is not one this
     *     agent may assign.
     * @ggop board.create_issue
     */
    public static IssueCreated createIssue(String title, String inScope, String outOfScope,
            String completionCriteria, String agent) {
        return createIssue(title, inScope, outOfScope, completionCriteria, agent,
                new IssueOptions());
    }

    /**
     * Create an issue carrying a description, blockers, an epic, reviewers, or any of the four.
     *
     * @param title A short line naming the work.
     * @param inScope What the issue covers, precisely. Part of the brief a child agent is given.
     * @param outOfScope What the issue deliberately does not cover.
     * @param completionCriteria What must be true for the issue to be done.
     * @param agent The agent the issue is dispatched to. It must be one this agent may spawn.
     * @param options The parts an issue may leave out: its description, its blockers, the epic to
     *     group it under, and the agents that must approve the work.
     * @return the id the board assigned, and how much of the board budget is now used
     * @throws ToolError {@link ToolErrorCode#INVALID_ARGUMENT} when {@code agent} or a reviewer is
     *     not one this agent may assign, and {@link ToolErrorCode#CONFLICT} on a blocker edge that
     *     would close a cycle.
     * @ggop board.create_issue
     */
    public static IssueCreated createIssue(String title, String inScope, String outOfScope,
            String completionCriteria, String agent, IssueOptions options) {
        JSObject issue = options.lowered();
        Wire.set(issue, "title", Wire.text(title));
        Wire.set(issue, "inScope", Wire.text(inScope));
        Wire.set(issue, "outOfScope", Wire.text(outOfScope));
        Wire.set(issue, "completionCriteria", Wire.text(completionCriteria));
        Wire.set(issue, "agent", Wire.text(agent));
        return Read.issueCreated(Wire.call("create_issue", Wire.project(), "project",
                "createIssue", Wire.args(issue)));
    }

    /**
     * Revise an issue, with a revision built from {@code Board.IssuePatch}.
     *
     * <p>The revision has to carry at least one field, and a field it never names is left alone.
     *
     * @param id The issue to revise.
     * @param patch The fields to change. It must carry at least one.
     * @throws ToolError {@link ToolErrorCode#NOT_FOUND} for an unknown id.
     * @ggop board.update_issue
     */
    public static void updateIssue(String id, IssuePatch patch) {
        Wire.run("update_issue", Wire.project(), "project", "updateIssue",
                Wire.args(Wire.text(id), patch.lowered()));
    }

    /**
     * Replace an issue's whole blocker set; naming none clears every blocker.
     *
     * @param id The issue whose blockers to replace.
     * @param blockedBy The ids of every issue that must now be done before it. Naming none clears
     *     them all.
     * @throws ToolError {@link ToolErrorCode#NOT_FOUND} for an unknown id, and
     *     {@link ToolErrorCode#CONFLICT} when an edge would close a cycle.
     * @ggop board.set_issue_blocked_by
     */
    public static void setIssueBlockedBy(String id, String... blockedBy) {
        Wire.run("set_issue_blocked_by", Wire.project(), "project", "setIssueBlockedBy",
                Wire.args(Wire.text(id), Wire.texts(blockedBy)));
    }

    /**
     * Remove an epic, keeping its issues and ungrouping them.
     *
     * @param id The epic to remove.
     * @return how much of the board budget is now used
     * @throws ToolError {@link ToolErrorCode#NOT_FOUND} for an unknown id.
     * @ggop board.remove_epic
     */
    public static BoardUsage removeEpic(String id) {
        return Read.boardUsage(Wire.call("remove_epic", Wire.project(), "project", "removeEpic",
                Wire.args(Wire.text(id))));
    }

    /**
     * Remove an issue and every blocker edge pointing at it.
     *
     * @param id The issue to remove.
     * @return how much of the board budget is now used
     * @throws ToolError {@link ToolErrorCode#NOT_FOUND} for an unknown id.
     * @ggop board.remove_issue
     */
    public static BoardUsage removeIssue(String id) {
        return Read.boardUsage(Wire.call("remove_issue", Wire.project(), "project", "removeIssue",
                Wire.args(Wire.text(id))));
    }

    /**
     * Register a wait on an issue, which suspends the session between turns rather than now.
     *
     * <p>It records the wait and returns at once, so the rest of the program still runs. Once the
     * program ends the run suspends, freeing this agent's slot for others, until the issue is
     * terminal — done, or failed if its assigned agent could not complete it — and then resumes on
     * the next turn. It is how the next turn's work is sequenced behind an issue this one depends on.
     *
     * @param id The issue to wait on. It may not be the issue this agent was itself assigned.
     * @return gg's acknowledgement that the wait is registered
     * @throws ToolError {@link ToolErrorCode#NOT_FOUND} for an unknown id.
     * @ggop board.wait_for_issue
     */
    public static String waitForIssue(String id) {
        return Wire.asString(Wire.call("wait_for_issue", Wire.project(), "project",
                "waitForIssue", Wire.args(Wire.text(id))));
    }

    // -------------------------------------------------------------------------------------------
    // The types the board takes and hands back
    // -------------------------------------------------------------------------------------------

    /**
     * How much of the run's board budget is used, after the call that returned it.
     *
     * @param epics Epics currently on the board.
     * @param maxEpics The most epics this run allows.
     * @param issues Issues currently on the board.
     * @param maxIssues The most issues this run allows.
     */
    public record BoardUsage(int epics, int maxEpics, int issues, int maxIssues) {
    }

    /**
     * An epic that was just created: the id its prefix resolved to, and the board budget.
     *
     * @param id The epic's id — the prefix given, upper-cased. Its issues are numbered from it.
     * @param board How much of the board budget is now used.
     */
    public record EpicCreated(String id, BoardUsage board) {
    }

    /**
     * An issue that was just created: the id the board assigned it, and the board budget.
     *
     * @param id The id the board assigned, which is what blocks a later issue on this one or waits
     *     for it.
     * @param board How much of the board budget is now used.
     */
    public record IssueCreated(String id, BoardUsage board) {

        /**
         * Register a wait on this issue, which is {@link Board#waitForIssue} on its own id.
         *
         * <p>It is named {@code await} rather than {@code wait} because {@code Object.wait} is final
         * and cannot be given another meaning.
         *
         * @return gg's acknowledgement that the wait is registered
         * @throws ToolError {@link ToolErrorCode#NOT_FOUND} when the issue has since been removed.
         * @ggalias board.wait_for_issue
         */
        public String await() {
            return Board.waitForIssue(id);
        }
    }

    /** Where an issue stands. */
    public enum IssueStatus {
        /** Not started, and dispatchable once its blockers are done. */
        OPEN("open"),
        /** Dispatched, with its assigned agent working on it. */
        IN_PROGRESS("in_progress"),
        /** Finished and, where this run requires reviewers, approved. */
        DONE("done");

        private final String wire;

        IssueStatus(String wire) {
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
     * The parts of a new issue that may be left out, built a call at a time.
     *
     * <p>An issue's required parts are arguments of {@code Board.createIssue} itself; these four are
     * the ones a program may say nothing about, and Java's answer to four optional fields is an
     * object whose setters chain rather than sixteen overloads.
     *
     * <pre>{@code
     * Board.createIssue(title, inScope, outOfScope, criteria, "builder",
     *         new Board.IssueOptions().epic("AUTH").reviewers("reviewer"));
     * }</pre>
     */
    public static final class IssueOptions {
        private final JSObject options = Wire.object();

        /** An issue with none of the optional parts filled in. */
        public IssueOptions() {
        }

        /**
         * Say what the work is, at whatever length is useful.
         *
         * @param description What the work is, written for a child agent with no other context.
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
         * Group the issue under an existing epic, which is what its id is numbered from.
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
         * @param reviewers The agents that must approve it, from the ones this agent may spawn.
         *     Required where this run has reviewers on.
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

    /**
     * The fields an issue revision changes, built a call at a time.
     *
     * <p>A revision has to carry at least one field, and a field it never names is left alone. Two
     * of them are three-way, which is why each has a clearing method beside its setter: never naming
     * the description keeps it and {@code clearDescription} empties it, and never naming the epic
     * leaves the grouping alone while {@code clearEpic} detaches the issue from the epic it has.
     */
    public static final class IssuePatch {
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
}
