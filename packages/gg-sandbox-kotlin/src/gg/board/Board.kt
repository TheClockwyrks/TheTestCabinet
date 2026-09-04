/**
 * The epic and issue board, shared by every agent in the run.
 *
 * An issue's scope, non-scope and completion criteria are what a delegated child agent is briefed
 * from.
 *
 * An issue revision's description and epic are three-way, and `gg.core.Patch` is how all three states
 * are said.
 *
 * @ggmodule board
 */
package gg.board

import gg.core.Patch
import gg.core.ApiError
import gg.internal.Read
import gg.internal.ggCall
import gg.internal.ggList
import gg.internal.ggRecord
import gg.internal.ggRun
import gg.internal.ggText
import gg.internal.ggTexts
import gg.internal.lowered
import gg.internal.loweredEpic


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
 * @throws ApiError `INVALID_ARGUMENT` when the prefix is not 3-6 letters, and `CONFLICT` when
 *   another epic already holds it.
 */
public fun createEpic(prefix: String, title: String, description: String): EpicCreated {
    val epic =
        ggRecord()
            .put("prefix", ggText(prefix))
            .put("title", ggText(title))
            .put("description", ggText(description))
    return Read.epicCreated(ggCall("board.create_epic", epic))
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
 * @param agent The agent the issue is dispatched to, from the ones this run permits.
 * @param description What the work is, at whatever length is useful, written for a child agent with
 *   no other context.
 * @param blockedBy The ids of every issue that must be done before this one.
 * @param epicId The id of an existing epic to group it under, which is also what its id is numbered
 *   from.
 * @param reviewers The agents that must approve the work. Required when this run's reviewers feature
 *   is on.
 * @return the id the board assigned, and how much of the board budget is now used
 * @throws ApiError `INVALID_ARGUMENT` when `agent` or a reviewer is not one to assign, and
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
    val issue =
        ggRecord()
            .put("title", ggText(title))
            .put("description", ggText(description))
            .put("in-scope", ggText(inScope))
            .put("out-of-scope", ggText(outOfScope))
            .put("completion-criteria", ggText(completionCriteria))
            .put("blocked-by", if (blockedBy == null) ggList() else ggTexts(blockedBy))
            .put("epic-id", ggText(epicId))
            .put("agent", ggText(agent))
            .put("reviewers", if (reviewers == null) ggList() else ggTexts(reviewers))
    return Read.issueCreated(ggCall("board.create_issue", issue))
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
 * @throws ApiError `NOT_FOUND` for an unknown id.
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
    val patch =
        ggRecord()
            .put("title", ggText(title))
            .put("description", description.lowered())
            .put("in-scope", ggText(inScope))
            .put("out-of-scope", ggText(outOfScope))
            .put("completion-criteria", ggText(completionCriteria))
            .put("status", ggText(status?.wireName))
            .put("epic", epicId.loweredEpic())
    ggRun("board.update_issue", ggText(id), patch)
}

/**
 * Replace an issue's whole blocker set; naming none clears every blocker.
 *
 * @ggop board.set_issue_blocked_by
 * @param id The issue whose blockers to replace.
 * @param blockedBy The ids of every issue that must now be done before it.
 * @throws ApiError `NOT_FOUND` for an unknown id, and `CONFLICT` when an edge would close a cycle.
 */
public fun setIssueBlockedBy(id: String, vararg blockedBy: String) {
    ggRun("board.set_issue_blocked_by", ggText(id), ggTexts(blockedBy.asIterable()))
}

/**
 * Remove an epic, keeping its issues and ungrouping them.
 *
 * @ggop board.remove_epic
 * @param id The epic to remove.
 * @return how much of the board budget is now used
 * @throws ApiError `NOT_FOUND` for an unknown id.
 */
public fun removeEpic(id: String): BoardUsage =
    Read.boardUsage(ggCall("board.remove_epic", ggText(id)))

/**
 * Remove an issue and every blocker edge pointing at it.
 *
 * @ggop board.remove_issue
 * @param id The issue to remove.
 * @return how much of the board budget is now used
 * @throws ApiError `NOT_FOUND` for an unknown id.
 */
public fun removeIssue(id: String): BoardUsage =
    Read.boardUsage(ggCall("board.remove_issue", ggText(id)))

/**
 * Register a wait on an issue and hand back gg's acknowledgement.
 *
 * It does not block inside the program: the wait is recorded and the call returns at once, so the
 * rest of the program still runs. The suspension happens after the program ends, and the session
 * resumes on the next turn once the issue is terminal.
 *
 * @ggop board.wait_for_issue
 * @param id The issue to wait on. It may not be the issue this session was assigned.
 * @return gg's acknowledgement that the wait is registered
 * @throws ApiError `NOT_FOUND` for an unknown id.
 */
public fun waitForIssue(id: String): String =
    ggCall("board.wait_for_issue", ggText(id)).text()

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
     * @ggalias board.wait_for_issue
     * @return gg's acknowledgement that the wait is registered
     * @throws ApiError `NOT_FOUND` when the board no longer holds the issue.
     */
    public fun wait(): String = waitForIssue(id)
}

/**
 * Where an issue stands.
 *
 * @property wireName gg's own word for this status.
 */
public enum class IssueStatus(public val wireName: String) {
    /** Not started, and dispatchable once its blockers are done. */
    OPEN("open"),

    /** Dispatched, with its assigned agent working on it. */
    IN_PROGRESS("in-progress"),

    /** Finished and, where this run requires reviewers, approved. */
    DONE("done"),
}
