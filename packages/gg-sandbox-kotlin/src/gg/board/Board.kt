/**
 * The epic and issue board, shared by every agent in the run.
 *
 * An issue is the heavyweight unit of work: its scope, non-scope and completion criteria are exactly
 * what a delegated child agent is briefed from, which is why creating one asks for more than adding a
 * task does. Its five required parts are positional, and the four a program may say nothing about are
 * default arguments, so a call that wants one of them names that one and no other.
 *
 * Two of a revision's fields are three-way, and `gg.core.Patch` is how all three states are said.
 *
 * @ggmodule board
 */
package gg.board

import gg.core.Patch
import gg.core.ToolError
import gg.internal.Read
import gg.internal.ggArgs
import gg.internal.ggAsString
import gg.internal.ggCall
import gg.internal.ggRecord
import gg.internal.ggRun
import gg.internal.ggSet
import gg.internal.ggText
import gg.internal.ggTexts
import gg.internal.lower
import gg.internal.projectObject


/**
 * Create an epic to group related issues, and hand back the id its prefix resolved to.
 *
 * The prefix is upper-cased into the epic's id and becomes the stem its issues are numbered from, so
 * a prefix of `auth` gives `AUTH-1`, `AUTH-2`, and so on.
 *
 * @ggop board.create_epic
 * @param prefix 3-6 letters naming it, upper-cased into the epic's id.
 * @param title A short line naming the body of work.
 * @param description What the epic covers, for a reader who has not seen its issues.
 * @return the epic's id, and how much of the board budget is now used
 * @throws ToolError `INVALID_ARGUMENT` when the prefix is not 3-6 letters, and `CONFLICT` when
 *   another epic already holds it.
 */
public fun createEpic(prefix: String, title: String, description: String): EpicCreated {
    val epic = ggRecord()
    ggSet(epic, "prefix", ggText(prefix))
    ggSet(epic, "title", ggText(title))
    ggSet(epic, "description", ggText(description))
    return Read.epicCreated(ggCall("create_epic", projectObject(), "gg.board", "createEpic", ggArgs(epic)))
}

/**
 * Create a self-contained, dispatchable issue, and hand back the id the board assigned it.
 *
 * The id is numbered under its epic's prefix (`AUTH-1`, `AUTH-2`, …), or under `ISSUE` when the issue
 * has no epic. The board chooses it, so the returned id is what blocks a later issue on this one or
 * waits for it.
 *
 * ```
 * val created = gg.board.createIssue(
 *     "parse the manifest", inScope, outOfScope, criteria, "builder",
 *     epicId = "AUTH", reviewers = listOf("critic"),
 * )
 * ```
 *
 * @ggop board.create_issue
 * @param title A short line naming the work.
 * @param inScope What the issue covers, precisely. Part of the brief a child agent is given.
 * @param outOfScope What the issue deliberately does not cover, so the work stops where it was meant
 *   to.
 * @param completionCriteria What must be true for the issue to be done, which is what a reviewer
 *   checks the work against.
 * @param agent The agent the issue is dispatched to. It must be one this agent may spawn.
 * @param description What the work is, at whatever length is useful, written for a child agent with
 *   no other context.
 * @param blockedBy The ids of every issue that must be done before this one.
 * @param epicId The id of an existing epic to group it under, which is also what its id is numbered
 *   from.
 * @param reviewers The agents that must approve the work. Required when this run's reviewers feature
 *   is on.
 * @return the id the board assigned, and how much of the board budget is now used
 * @throws ToolError `INVALID_ARGUMENT` when `agent` or a reviewer is not one to assign, and
 *   `CONFLICT` on a blocker edge that would close a cycle.
 */
public fun createIssue(
    title: String,
    inScope: String,
    outOfScope: String,
    completionCriteria: String,
    agent: String,
    description: String? = null,
    blockedBy: List<String>? = null,
    epicId: String? = null,
    reviewers: List<String>? = null,
): IssueCreated {
    val issue = ggRecord()
    ggSet(issue, "title", ggText(title))
    ggSet(issue, "inScope", ggText(inScope))
    ggSet(issue, "outOfScope", ggText(outOfScope))
    ggSet(issue, "completionCriteria", ggText(completionCriteria))
    ggSet(issue, "agent", ggText(agent))
    if (description != null) {
        ggSet(issue, "description", ggText(description))
    }
    if (blockedBy != null) {
        ggSet(issue, "blockedBy", ggTexts(blockedBy))
    }
    if (epicId != null) {
        ggSet(issue, "epicId", ggText(epicId))
    }
    if (reviewers != null) {
        ggSet(issue, "reviewers", ggTexts(reviewers))
    }
    return Read.issueCreated(ggCall("create_issue", projectObject(), "gg.board", "createIssue", ggArgs(issue)))
}

/**
 * Revise an issue: naming a field replaces it, and a field left out is left alone.
 *
 * `description` and `epicId` are three-way, so each takes a `gg.core.Patch` rather than a value —
 * `Patch.Replace("…")` to replace it, `Patch.Clear` to empty the description or to detach the issue
 * from its epic, and nothing at all to leave it as it is.
 *
 * @ggop board.update_issue
 * @param id The issue to revise.
 * @param title The title to replace the old one with.
 * @param description The description to replace the old one with, or `Patch.Clear` to leave the
 *   issue with none.
 * @param inScope The scope statement to replace the old one with.
 * @param outOfScope The non-scope statement to replace the old one with.
 * @param completionCriteria The completion criteria to replace the old ones with.
 * @param status Where the issue now stands.
 * @param epicId The epic to regroup it under, or `Patch.Clear` to leave it ungrouped.
 * @throws ToolError `NOT_FOUND` for an unknown id.
 */
public fun updateIssue(
    id: String,
    title: String? = null,
    description: Patch<String>? = null,
    inScope: String? = null,
    outOfScope: String? = null,
    completionCriteria: String? = null,
    status: IssueStatus? = null,
    epicId: Patch<String>? = null,
) {
    val patch = ggRecord()
    if (title != null) {
        ggSet(patch, "title", ggText(title))
    }
    description?.lower(patch, "description")
    if (inScope != null) {
        ggSet(patch, "inScope", ggText(inScope))
    }
    if (outOfScope != null) {
        ggSet(patch, "outOfScope", ggText(outOfScope))
    }
    if (completionCriteria != null) {
        ggSet(patch, "completionCriteria", ggText(completionCriteria))
    }
    if (status != null) {
        ggSet(patch, "status", ggText(status.wireName))
    }
    epicId?.lower(patch, "epicId")
    ggRun("update_issue", projectObject(), "gg.board", "updateIssue", ggArgs(ggText(id), patch))
}

/**
 * Replace an issue's whole blocker set; naming none clears every blocker.
 *
 * @ggop board.set_issue_blocked_by
 * @param id The issue whose blockers to replace.
 * @param blockedBy The ids of every issue that must now be done before it.
 * @throws ToolError `NOT_FOUND` for an unknown id, and `CONFLICT` when an edge would close a cycle.
 */
public fun setIssueBlockedBy(id: String, vararg blockedBy: String) {
    ggRun(
        "set_issue_blocked_by",
        projectObject(),
        "gg.board",
        "setIssueBlockedBy",
        ggArgs(ggText(id), ggTexts(blockedBy.asIterable())),
    )
}

/**
 * Remove an epic, keeping its issues and ungrouping them.
 *
 * @ggop board.remove_epic
 * @param id The epic to remove.
 * @return how much of the board budget is now used
 * @throws ToolError `NOT_FOUND` for an unknown id.
 */
public fun removeEpic(id: String): BoardUsage =
    Read.boardUsage(ggCall("remove_epic", projectObject(), "gg.board", "removeEpic", ggArgs(ggText(id))))

/**
 * Remove an issue and every blocker edge pointing at it.
 *
 * @ggop board.remove_issue
 * @param id The issue to remove.
 * @return how much of the board budget is now used
 * @throws ToolError `NOT_FOUND` for an unknown id.
 */
public fun removeIssue(id: String): BoardUsage =
    Read.boardUsage(ggCall("remove_issue", projectObject(), "gg.board", "removeIssue", ggArgs(ggText(id))))

/**
 * Register a wait on an issue and hand back gg's acknowledgement.
 *
 * It does not block inside the program: the wait is recorded and the call returns at once, so the
 * rest of the program still runs. The suspension happens after the program ends and between turns —
 * the run frees this agent's slot for others until the issue is terminal, then resumes on the next
 * turn. It is how the next turn's work is sequenced behind an issue this one depends on.
 *
 * @ggop board.wait_for_issue
 * @param id The issue to wait on. It may not be the issue this agent was assigned.
 * @return gg's acknowledgement that the wait is registered
 * @throws ToolError `NOT_FOUND` for an unknown id.
 */
public fun waitForIssue(id: String): String =
    ggAsString(ggCall("wait_for_issue", projectObject(), "gg.board", "waitForIssue", ggArgs(ggText(id))))

/**
 * How much of the run's board budget is used, after the call that returned it.
 *
 * @property epics Epics currently on the board.
 * @property maxEpics The most epics this run allows.
 * @property issues Issues currently on the board.
 * @property maxIssues The most issues this run allows.
 */
public data class BoardUsage(
    val epics: Int,
    val maxEpics: Int,
    val issues: Int,
    val maxIssues: Int,
)

/**
 * An epic that was just created: the id its prefix resolved to, and the board budget.
 *
 * @property id The epic's id — the prefix given, upper-cased (`auth` becomes `AUTH`). Its issues are
 *   numbered from it, as `AUTH-1`.
 * @property board How much of the board budget is used.
 */
public data class EpicCreated(val id: String, val board: BoardUsage)

/**
 * An issue that was just created: the id the board assigned, and the board budget.
 *
 * @property id The id the board assigned, such as `AUTH-1`. It is what blocks a later issue on this
 *   one, or waits for it.
 * @property board How much of the board budget is used.
 */
public data class IssueCreated(val id: String, val board: BoardUsage) {
    /**
     * Register a wait on this issue, with its id already supplied.
     *
     * `gg.board.waitForIssue` for the common case where the created issue is in hand, written as a
     * member so that the value carrying the id is what the call hangs off.
     *
     * @ggalias board.wait_for_issue
     * @return gg's acknowledgement that the wait is registered
     * @throws ToolError `NOT_FOUND` when the board no longer holds the issue.
     */
    public fun wait(): String = waitForIssue(id)
}

/**
 * Where an issue stands.
 *
 * @property wireName gg's own word for this status, which is what both execution modes report.
 */
public enum class IssueStatus(public val wireName: String) {
    /** Not started, and dispatchable once its blockers are done. */
    OPEN("open"),

    /** Dispatched, with its assigned agent working on it. */
    IN_PROGRESS("in_progress"),

    /** Finished and, where this run requires reviewers, approved. */
    DONE("done"),
}
