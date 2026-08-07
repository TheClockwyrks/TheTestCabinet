import org.teavm.jso.JSObject

/**
 * The `project` object: the epic/issue board.
 *
 * An issue is the heavyweight unit of work — its scope, non-scope and completion criteria are exactly
 * what a delegated child agent is briefed from — which is why `createIssue` asks for more than
 * `tasks.addTask` does. Its five required parts are positional; the four a program may say nothing
 * about are **default arguments**, so a call that wants one of them names that one and no other.
 *
 * Two of `updateIssue`'s fields are **three-way**, and [Patch] is how all three states are said: never
 * name `description` to keep it, [Patch.Clear] to empty it, [Patch.Replace] to replace it.
 */
public class Project internal constructor() : ApiObject("project") {
    override fun target(): JSObject? = projectObject()

    /**
     * Create an epic to group related issues, and hand back the id its prefix resolved to together with
     * the board budget.
     *
     * @param prefix 3-6 letters naming it. Upper-cased, it becomes the epic's id and the stem its
     *   issues are numbered from — a prefix of `auth` gives issues `AUTH-1`, `AUTH-2`, and so on.
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
        return Read.epicCreated(
            ggCall("create_epic", target(), owner, "createEpic", ggArgs(epic)),
        )
    }

    /**
     * Create a self-contained, dispatchable issue, and hand back the id the board **assigned** it
     * together with the board budget.
     *
     * The id is numbered under its epic's prefix (`AUTH-1`, `AUTH-2`, …), or under `ISSUE` when it has
     * no epic; you do not choose it, so keep the returned one to block a later issue on this one or to
     * wait for it.
     *
     * ```
     * val created = project.createIssue(
     *     "parse the manifest", inScope, outOfScope, criteria, "builder",
     *     epicId = "AUTH", reviewers = listOf("critic"),
     * )
     * ```
     *
     * @param title A short line naming the work.
     * @param inScope What the issue covers, precisely. Part of the brief a child agent is given.
     * @param outOfScope What the issue deliberately does not cover, so the work stops where you meant
     *   it to.
     * @param completionCriteria What must be true for the issue to be done. It is what a reviewer checks
     *   the work against.
     * @param agent The agent the issue is dispatched to. It must be one you may spawn.
     * @param description What the work is, at whatever length is useful. Written for a child agent with
     *   no other context.
     * @param blockedBy The ids of every issue that must be done before this one.
     * @param epicId The id of an existing epic to group it under, which is also what its id is numbered
     *   from.
     * @param reviewers The agents that must approve the work, from the ones you may spawn. Required when
     *   this run's reviewers feature is on.
     * @return the id the board assigned, and how much of the board budget is now used
     * @throws ToolError `INVALID_ARGUMENT` when `agent` or a reviewer is not yours to assign, and
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
        return Read.issueCreated(
            ggCall("create_issue", target(), owner, "createIssue", ggArgs(issue)),
        )
    }

    /**
     * Revise an issue: name at least one field, and a field you never name is left alone.
     *
     * `description` and `epicId` are **three-way**, so each takes a [Patch] rather than a value —
     * `Patch.Replace("…")` to replace it, [Patch.Clear] to empty the description or to detach the issue
     * from its epic, and nothing at all to leave it as it is.
     *
     * ```
     * project.updateIssue("AUTH-1", status = IssueStatus.DONE, epicId = Patch.Clear)
     * ```
     *
     * @param id The issue to revise.
     * @param title The title to replace the old one with.
     * @param description The description to replace the old one with, or [Patch.Clear] to leave the
     *   issue with none.
     * @param inScope The scope statement to replace the old one with.
     * @param outOfScope The non-scope statement to replace the old one with.
     * @param completionCriteria The completion criteria to replace the old ones with.
     * @param status Where the issue now stands.
     * @param epicId The epic to regroup it under, or [Patch.Clear] to leave it ungrouped.
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
        ggRun("update_issue", target(), owner, "updateIssue", ggArgs(ggText(id), patch))
    }

    /**
     * Replace an issue's whole blocker set; naming none clears every blocker.
     *
     * @param id The issue whose blockers to replace.
     * @param blockedBy The ids of every issue that must now be done before it. Naming none clears them
     *   all.
     * @throws ToolError `NOT_FOUND` for an unknown id, and `CONFLICT` when an edge would close a cycle.
     */
    public fun setIssueBlockedBy(id: String, vararg blockedBy: String) {
        ggRun(
            "set_issue_blocked_by",
            target(),
            owner,
            "setIssueBlockedBy",
            ggArgs(ggText(id), ggTexts(blockedBy.asIterable())),
        )
    }

    /**
     * Remove an epic, keeping its issues and ungrouping them, and hand back the board budget.
     *
     * @param id The epic to remove.
     * @return how much of the board budget is now used
     * @throws ToolError `NOT_FOUND` for an unknown id.
     */
    public fun removeEpic(id: String): BoardUsage =
        Read.boardUsage(
            ggCall("remove_epic", target(), owner, "removeEpic", ggArgs(ggText(id))),
        )

    /**
     * Remove an issue and every blocker edge pointing at it, and hand back the board budget.
     *
     * @param id The issue to remove.
     * @return how much of the board budget is now used
     * @throws ToolError `NOT_FOUND` for an unknown id.
     */
    public fun removeIssue(id: String): BoardUsage =
        Read.boardUsage(
            ggCall("remove_issue", target(), owner, "removeIssue", ggArgs(ggText(id))),
        )

    /**
     * Register a wait on an issue and hand back an acknowledgement.
     *
     * It does not block inside your program — it records the wait and returns at once, so the rest of
     * your program still runs; the suspension happens after the program ends, between turns. Once the
     * program finishes the run suspends, freeing this agent's slot for others, until the issue is
     * terminal (done, or failed if its assigned agent could not complete it), then resumes on the next
     * turn. Use it to sequence your next turn's work behind an issue you depend on.
     *
     * @param id The issue to wait on. It may not be the issue you were assigned.
     * @return gg's acknowledgement that the wait is registered
     * @throws ToolError `NOT_FOUND` for an unknown id.
     */
    public fun waitForIssue(id: String): String =
        ggAsString(
            ggCall("wait_for_issue", target(), owner, "waitForIssue", ggArgs(ggText(id))),
        )
}
