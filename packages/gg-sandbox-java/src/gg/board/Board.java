package gg.board;

import gg.ApiError;
import gg.ApiErrorCode;
import gg.internal.Coding;
import gg.internal.Read;
import gg.internal.Value;
import java.util.List;

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
     * Create an epic to group related issues under one prefix.
     *
     * <p>The prefix, upper-cased, becomes the epic's id and the stem its issues are numbered from: a
     * prefix of {@code auth} gives {@code AUTH-1}, {@code AUTH-2}, and so on.
     *
     * @param prefix Three to six letters naming it, which upper-cased become its id.
     * @param title A short line naming the body of work.
     * @param description What the epic covers, for a reader who has not seen its issues.
     * @return the epic's id, and how much of the board budget is now used
     * @throws ApiError {@link ApiErrorCode#INVALID_ARGUMENT} when the prefix is not three to six
     *     letters, and {@link ApiErrorCode#CONFLICT} when another epic already holds it.
     * @ggop board.create_epic
     */
    public static EpicCreated createEpic(String prefix, String title, String description) {
        Value epic = Value.record()
                .put("prefix", Value.of(prefix))
                .put("title", Value.of(title))
                .put("description", Value.of(description));
        return Read.epicCreated(Coding.call("board.create_epic", epic));
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
     * @throws ApiError {@link ApiErrorCode#INVALID_ARGUMENT} when {@code agent} is not one this
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
     * @throws ApiError {@link ApiErrorCode#INVALID_ARGUMENT} when {@code agent} or a reviewer is
     *     not one this agent may assign, and {@link ApiErrorCode#CONFLICT} on a blocker edge that
     *     would close a cycle.
     * @ggop board.create_issue
     */
    public static IssueCreated createIssue(String title, String inScope, String outOfScope,
            String completionCriteria, String agent, IssueOptions options) {
        Value issue = Value.record()
                .put("title", Value.of(title))
                .put("description", options.description)
                .put("in-scope", Value.of(inScope))
                .put("out-of-scope", Value.of(outOfScope))
                .put("completion-criteria", Value.of(completionCriteria))
                .put("blocked-by", options.blockedBy)
                .put("epic-id", options.epicId)
                .put("agent", Value.of(agent))
                .put("reviewers", options.reviewers);
        return Read.issueCreated(Coding.call("board.create_issue", issue));
    }

    /**
     * Revise an issue, with a revision built from {@code Board.IssuePatch}.
     *
     * <p>The revision has to carry at least one field, and a field it never names is left alone.
     *
     * @param id The issue to revise.
     * @param patch The fields to change. It must carry at least one.
     * @throws ApiError {@link ApiErrorCode#NOT_FOUND} for an unknown id.
     * @ggop board.update_issue
     */
    public static void updateIssue(String id, IssuePatch patch) {
        Coding.call("board.update_issue", Value.of(id), patch.lowered());
    }

    /**
     * Replace an issue's whole blocker set; naming none clears every blocker.
     *
     * @param id The issue whose blockers to replace.
     * @param blockedBy The ids of every issue that must now be done before it. Naming none clears
     *     them all.
     * @throws ApiError {@link ApiErrorCode#NOT_FOUND} for an unknown id, and
     *     {@link ApiErrorCode#CONFLICT} when an edge would close a cycle.
     * @ggop board.set_issue_blocked_by
     */
    public static void setIssueBlockedBy(String id, String... blockedBy) {
        Coding.call("board.set_issue_blocked_by", Value.of(id), Value.texts(blockedBy));
    }

    /**
     * Remove an epic, keeping its issues and ungrouping them.
     *
     * @param id The epic to remove.
     * @return how much of the board budget is now used
     * @throws ApiError {@link ApiErrorCode#NOT_FOUND} for an unknown id.
     * @ggop board.remove_epic
     */
    public static BoardUsage removeEpic(String id) {
        return Read.boardUsage(Coding.call("board.remove_epic", Value.of(id)));
    }

    /**
     * Remove an issue and every blocker edge pointing at it.
     *
     * @param id The issue to remove.
     * @return how much of the board budget is now used
     * @throws ApiError {@link ApiErrorCode#NOT_FOUND} for an unknown id.
     * @ggop board.remove_issue
     */
    public static BoardUsage removeIssue(String id) {
        return Read.boardUsage(Coding.call("board.remove_issue", Value.of(id)));
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
     * @throws ApiError {@link ApiErrorCode#NOT_FOUND} for an unknown id.
     * @ggop board.wait_for_issue
     */
    public static String waitForIssue(String id) {
        return Coding.call("board.wait_for_issue", Value.of(id)).text();
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
         * @throws ApiError {@link ApiErrorCode#NOT_FOUND} when the issue has since been removed.
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
        IN_PROGRESS("in-progress"),
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
        /** The description, absent until one is named. */
        Value description = Value.none();

        /** The issues this one waits on; empty until some are named. */
        Value blockedBy = Value.list();

        /** The epic this issue is grouped under, absent until one is named. */
        Value epicId = Value.none();

        /** Who reviews the work; empty until some are named. */
        Value reviewers = Value.list();

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
            this.description = Value.of(description);
            return this;
        }

        /**
         * Block the issue on others, which must be done before it.
         *
         * @param blockedBy The ids of every issue that must be done before this one.
         * @return these options, so calls chain
         */
        public IssueOptions blockedBy(String... blockedBy) {
            this.blockedBy = Value.texts(blockedBy);
            return this;
        }

        /**
         * Group the issue under an existing epic, which is what its id is numbered from.
         *
         * @param epicId The id of an existing epic to group it under.
         * @return these options, so calls chain
         */
        public IssueOptions epic(String epicId) {
            this.epicId = Value.of(epicId);
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
            this.reviewers = Value.texts(reviewers);
            return this;
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
        /** The new title, absent until one is named. */
        private Value title = Value.none();

        /** What to do to the description: keep it, clear it, or set it. */
        private Value description = Value.variant("keep", null);

        /** What is in scope, absent until it is named. */
        private Value inScope = Value.none();

        /** What is out of scope, absent until it is named. */
        private Value outOfScope = Value.none();

        /** The completion criteria, absent until they are named. */
        private Value completionCriteria = Value.none();

        /** The new status, absent until one is named. */
        private Value status = Value.none();

        /** What to do to the epic: keep it, ungroup the issue, or set it. */
        private Value epic = Value.variant("keep", null);

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
            this.title = Value.of(title);
            return this;
        }

        /**
         * Replace the issue's description.
         *
         * @param description The description to replace the old one with.
         * @return this revision, so calls chain
         */
        public IssuePatch description(String description) {
            this.description = Value.variant("set", Value.of(description));
            return this;
        }

        /**
         * Clear the issue's description, leaving it with none.
         *
         * @return this revision, so calls chain
         */
        public IssuePatch clearDescription() {
            this.description = Value.variant("clear", null);
            return this;
        }

        /**
         * Replace what the issue covers.
         *
         * @param inScope The scope statement to replace the old one with.
         * @return this revision, so calls chain
         */
        public IssuePatch inScope(String inScope) {
            this.inScope = Value.of(inScope);
            return this;
        }

        /**
         * Replace what the issue deliberately does not cover.
         *
         * @param outOfScope The non-scope statement to replace the old one with.
         * @return this revision, so calls chain
         */
        public IssuePatch outOfScope(String outOfScope) {
            this.outOfScope = Value.of(outOfScope);
            return this;
        }

        /**
         * Replace what must be true for the issue to be done.
         *
         * @param completionCriteria The completion criteria to replace the old ones with.
         * @return this revision, so calls chain
         */
        public IssuePatch completionCriteria(String completionCriteria) {
            this.completionCriteria = Value.of(completionCriteria);
            return this;
        }

        /**
         * Move the issue to another status.
         *
         * @param status Where the issue now stands.
         * @return this revision, so calls chain
         */
        public IssuePatch status(IssueStatus status) {
            this.status = Value.of(status.wireName());
            return this;
        }

        /**
         * Regroup the issue under another epic.
         *
         * @param epicId The epic to regroup it under.
         * @return this revision, so calls chain
         */
        public IssuePatch epic(String epicId) {
            this.epic = Value.variant("set", Value.of(epicId));
            return this;
        }

        /**
         * Detach the issue from the epic it has, leaving it ungrouped.
         *
         * @return this revision, so calls chain
         */
        public IssuePatch clearEpic() {
            this.epic = Value.variant("ungroup", null);
            return this;
        }

        /** What was set, on its way out. */
        Value lowered() {
            return Value.record()
                    .put("title", title)
                    .put("description", description)
                    .put("in-scope", inScope)
                    .put("out-of-scope", outOfScope)
                    .put("completion-criteria", completionCriteria)
                    .put("status", status)
                    .put("epic", epic);
        }
    }
}
