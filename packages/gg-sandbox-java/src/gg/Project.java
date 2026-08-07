package gg;

import gg.internal.Read;
import gg.internal.Wire;
import org.teavm.jso.JSObject;

/**
 * The {@code project} object: the epic/issue board.
 *
 * <p>An issue is the heavyweight unit of work — its scope, non-scope and completion criteria are
 * exactly what a delegated child agent is briefed from — which is why {@code createIssue} asks for
 * more than {@code tasks.addTask} does. Its five required parts are ordinary arguments; the four a
 * program may say nothing about are {@link IssueOptions}.
 *
 * <p>Two of {@link IssuePatch}'s fields are <b>three-way</b>: never name {@code description} to
 * keep it and clear it to empty it; never name the epic to leave the grouping alone and clear it
 * to detach the issue from its epic.
 */
public final class Project extends ApiObject {
    Project() {
        super("project");
    }

    @Override
    JSObject target() {
        return Wire.project();
    }

    /**
     * Create an epic to group related issues, and hand back the id its prefix resolved to together
     * with the board budget.
     *
     * @param prefix 3-6 letters naming it. Upper-cased, it becomes the epic's id and the stem its
     *     issues are numbered from — a prefix of {@code auth} gives issues {@code AUTH-1},
     *     {@code AUTH-2}, and so on.
     * @param title A short line naming the body of work.
     * @param description What the epic covers, for a reader who has not seen its issues.
     * @return the epic's id, and how much of the board budget is now used
     * @throws ToolError {@code INVALID_ARGUMENT} when the prefix is not 3-6 letters, and
     *     {@code CONFLICT} when another epic already holds it.
     */
    public EpicCreated createEpic(String prefix, String title, String description) {
        JSObject epic = Wire.object();
        Wire.set(epic, "prefix", Wire.text(prefix));
        Wire.set(epic, "title", Wire.text(title));
        Wire.set(epic, "description", Wire.text(description));
        return Read.epicCreated(Wire.call("create_epic", target(), object(), "createEpic",
                Wire.args(epic)));
    }

    /**
     * Create a self-contained, dispatchable issue, and hand back the id the board <b>assigned</b>
     * it together with the board budget.
     *
     * <p>The id is numbered under its epic's prefix ({@code AUTH-1}, {@code AUTH-2}, …), or under
     * {@code ISSUE} when it has no epic; you do not choose it, so keep the returned one to block a
     * later issue on this one or to wait for it.
     *
     * @param title A short line naming the work.
     * @param inScope What the issue covers, precisely. Part of the brief a child agent is given.
     * @param outOfScope What the issue deliberately does not cover, so the work stops where you
     *     meant it to.
     * @param completionCriteria What must be true for the issue to be done. It is what a reviewer
     *     checks the work against.
     * @param agent The agent the issue is dispatched to. It must be one you may spawn.
     * @return the id the board assigned, and how much of the board budget is now used
     * @throws ToolError {@code INVALID_ARGUMENT} when {@code agent} is not yours to assign.
     */
    public IssueCreated createIssue(String title, String inScope, String outOfScope,
            String completionCriteria, String agent) {
        return createIssue(title, inScope, outOfScope, completionCriteria, agent,
                new IssueOptions());
    }

    /**
     * Create an issue carrying a description, blockers, an epic, reviewers, or any combination of
     * the four.
     *
     * @param title A short line naming the work.
     * @param inScope What the issue covers, precisely. Part of the brief a child agent is given.
     * @param outOfScope What the issue deliberately does not cover.
     * @param completionCriteria What must be true for the issue to be done.
     * @param agent The agent the issue is dispatched to. It must be one you may spawn.
     * @param options The parts you may leave out: its description, its blockers, the epic to group
     *     it under, and the agents that must approve the work.
     * @return the id the board assigned, and how much of the board budget is now used
     * @throws ToolError {@code INVALID_ARGUMENT} when {@code agent} or a reviewer is not yours to
     *     assign, and {@code CONFLICT} on a blocker edge that would close a cycle.
     */
    public IssueCreated createIssue(String title, String inScope, String outOfScope,
            String completionCriteria, String agent, IssueOptions options) {
        JSObject issue = options.lowered();
        Wire.set(issue, "title", Wire.text(title));
        Wire.set(issue, "inScope", Wire.text(inScope));
        Wire.set(issue, "outOfScope", Wire.text(outOfScope));
        Wire.set(issue, "completionCriteria", Wire.text(completionCriteria));
        Wire.set(issue, "agent", Wire.text(agent));
        return Read.issueCreated(Wire.call("create_issue", target(), object(), "createIssue",
                Wire.args(issue)));
    }

    /**
     * Revise an issue.
     *
     * <p>Build the revision with {@link IssuePatch} and supply at least one field; a field you
     * never name is left alone.
     *
     * @param id The issue to revise.
     * @param patch The fields to change. Supply at least one; a field it does not carry is left
     *     alone.
     * @throws ToolError {@code NOT_FOUND} for an unknown id.
     */
    public void updateIssue(String id, IssuePatch patch) {
        Wire.run("update_issue", target(), object(), "updateIssue",
                Wire.args(Wire.text(id), patch.lowered()));
    }

    /**
     * Replace an issue's whole blocker set; naming none clears every blocker.
     *
     * @param id The issue whose blockers to replace.
     * @param blockedBy The ids of every issue that must now be done before it. Naming none clears
     *     them all.
     * @throws ToolError {@code NOT_FOUND} for an unknown id, and {@code CONFLICT} when an edge
     *     would close a cycle.
     */
    public void setIssueBlockedBy(String id, String... blockedBy) {
        Wire.run("set_issue_blocked_by", target(), object(), "setIssueBlockedBy",
                Wire.args(Wire.text(id), Wire.texts(blockedBy)));
    }

    /**
     * Remove an epic, keeping its issues and ungrouping them, and hand back the board budget.
     *
     * @param id The epic to remove.
     * @return how much of the board budget is now used
     * @throws ToolError {@code NOT_FOUND} for an unknown id.
     */
    public BoardUsage removeEpic(String id) {
        return Read.boardUsage(Wire.call("remove_epic", target(), object(), "removeEpic",
                Wire.args(Wire.text(id))));
    }

    /**
     * Remove an issue and every blocker edge pointing at it, and hand back the board budget.
     *
     * @param id The issue to remove.
     * @return how much of the board budget is now used
     * @throws ToolError {@code NOT_FOUND} for an unknown id.
     */
    public BoardUsage removeIssue(String id) {
        return Read.boardUsage(Wire.call("remove_issue", target(), object(), "removeIssue",
                Wire.args(Wire.text(id))));
    }

    /**
     * Register a wait on an issue and hand back an acknowledgement.
     *
     * <p>It does not block inside your program — it records the wait and returns at once, so the
     * rest of your program still runs; the suspension happens after the program ends, between
     * turns. Once the program finishes the run suspends, freeing this agent's slot for others,
     * until the issue is terminal (done, or failed if its assigned agent could not complete it),
     * then resumes on the next turn. Use it to sequence your next turn's work behind an issue you
     * depend on.
     *
     * @param id The issue to wait on. It may not be the issue you were assigned.
     * @return gg's acknowledgement that the wait is registered
     * @throws ToolError {@code NOT_FOUND} for an unknown id.
     */
    public String waitForIssue(String id) {
        return Wire.asString(Wire.call("wait_for_issue", target(), object(), "waitForIssue",
                Wire.args(Wire.text(id))));
    }
}
