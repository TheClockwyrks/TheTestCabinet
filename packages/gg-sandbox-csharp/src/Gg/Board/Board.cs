namespace Gg;

/// <summary>The epic and issue board, on which work is decomposed into dispatchable units.</summary>
/// <remarks>
/// An issue is heavyweight and self-contained: it says what is in scope, what is not, and how it
/// will be judged done, and gg dispatches it to the agent it names. That is what makes it different
/// from a task, which is a note an agent keeps for itself.
/// </remarks>
/// <ggmodule>board</ggmodule>
public static partial class Board
{
    /// <summary>Create an epic to group related issues under.</summary>
    /// <param name="prefix">
    /// A three to six letter prefix. Upper-cased it becomes the epic's id and the stem its issues
    /// are numbered from, so <c>auth</c> gives <c>AUTH</c>, then <c>AUTH-1</c>.
    /// </param>
    /// <param name="title">What the epic is called.</param>
    /// <param name="description">What the epic covers.</param>
    /// <returns>the id the prefix resolved to, and how full the board now is.</returns>
    /// <exception cref="ApiException">
    /// <see cref="ApiErrorCode.InvalidArgument"/> for a prefix that is not 3-6 letters or a blank
    /// field, <see cref="ApiErrorCode.Conflict"/> for a prefix already in use, and
    /// <see cref="ApiErrorCode.LimitExceeded"/> at the epic cap.
    /// </exception>
    /// <ggop>board.create_epic</ggop>
    public static EpicCreated CreateEpic(string prefix, string title, string description)
    {
        Internal.Wire.Check(Internal.Native.CreateEpic(
            prefix,
            title,
            description,
            out var id,
            out var epics,
            out var maxEpics,
            out var issues,
            out var maxIssues));
        return new EpicCreated(id, new BoardUsage(epics, maxEpics, issues, maxIssues));
    }

    /// <summary>Create a self-contained, dispatchable issue, and get back the id the board gave it.</summary>
    /// <remarks>
    /// <para>
    /// The three scope arguments are what makes an issue dispatchable: the agent that picks it up
    /// sees them and nothing of the conversation that produced them, so anything it needs has to be
    /// in them.
    /// </para>
    /// <code>
    /// var created = Board.CreateIssue(
    ///     title: "port the fixtures to the new schema",
    ///     inScope: "everything under tests/fixtures",
    ///     outOfScope: "the schema itself, which is already agreed",
    ///     completionCriteria: "cargo nextest run --workspace passes",
    ///     agent: "worker",
    ///     epicId: "AUTH");
    /// </code>
    /// </remarks>
    /// <param name="title">What the issue is called.</param>
    /// <param name="inScope">What this issue is responsible for.</param>
    /// <param name="outOfScope">What it is explicitly not responsible for.</param>
    /// <param name="completionCriteria">How it will be judged done.</param>
    /// <param name="agent">The agent gg dispatches it to, drawn from the spawnable set.</param>
    /// <param name="description">An overview, where the title does not carry it.</param>
    /// <param name="blockedBy">Ids of issues that must finish first. A cycle is refused.</param>
    /// <param name="epicId">The epic to group it under.</param>
    /// <param name="reviewers">
    /// The agents that must approve this issue's work, drawn from the same set as
    /// <paramref name="agent"/>. Required where the run's reviewers feature is on.
    /// </param>
    /// <returns>the id the board assigned, and how full the board now is.</returns>
    /// <exception cref="ApiException">
    /// <see cref="ApiErrorCode.InvalidArgument"/> for a blank field or an agent outside the
    /// spawnable set, <see cref="ApiErrorCode.NotFound"/> for an epic or blocker the board does not
    /// hold, and <see cref="ApiErrorCode.LimitExceeded"/> at the issue cap.
    /// </exception>
    /// <ggop>board.create_issue</ggop>
    public static IssueCreated CreateIssue(
        string title,
        string inScope,
        string outOfScope,
        string completionCriteria,
        string agent,
        string? description = null,
        string[]? blockedBy = null,
        string? epicId = null,
        string[]? reviewers = null)
    {
        Internal.Wire.Check(Internal.Native.CreateIssue(
            title,
            description,
            inScope,
            outOfScope,
            completionCriteria,
            Internal.Wire.Or(blockedBy),
            epicId,
            agent,
            Internal.Wire.Or(reviewers),
            out var id,
            out var board));
        return new IssueCreated(id, Internal.Wire.Board(board));
    }

    /// <summary>Revise an issue.</summary>
    /// <remarks>
    /// Everything is optional and what is left out is left alone. The description and the epic
    /// grouping are three-way values rather than nullable ones, so that clearing and leaving are
    /// different requests.
    /// </remarks>
    /// <param name="id">The issue to revise.</param>
    /// <param name="title">A new title.</param>
    /// <param name="description">A three-way edit of the description: keep it, clear it, or set it.</param>
    /// <param name="inScope">A new statement of what the issue covers.</param>
    /// <param name="outOfScope">A new statement of what it is explicitly not responsible for.</param>
    /// <param name="completionCriteria">New criteria for the work being done.</param>
    /// <param name="status">A new status.</param>
    /// <param name="epic">A change of grouping: keep it, ungroup it, or group it under an epic.</param>
    /// <exception cref="ApiException">
    /// <see cref="ApiErrorCode.NotFound"/> for an unknown issue or epic id, and
    /// <see cref="ApiErrorCode.InvalidArgument"/> when nothing at all was changed, or a field that
    /// must have a value was blanked.
    /// </exception>
    /// <ggop>board.update_issue</ggop>
    public static void UpdateIssue(
        string id,
        string? title = null,
        Tasks.TextEdit description = default,
        string? inScope = null,
        string? outOfScope = null,
        string? completionCriteria = null,
        IssueStatus? status = null,
        EpicAssignment epic = default) =>
        Internal.Wire.Check(Internal.Native.UpdateIssue(
            id,
            title,
            description.Kind,
            description.Text,
            inScope,
            outOfScope,
            completionCriteria,
            status.HasValue ? (int)status.Value : -1,
            epic.Kind,
            epic.EpicId));

    /// <summary>Replace an issue's whole blocker set.</summary>
    /// <param name="id">The issue whose blockers change.</param>
    /// <param name="blockedBy">
    /// The issue ids that must finish first, replacing whatever was there. An empty list clears
    /// every blocker.
    /// </param>
    /// <exception cref="ApiException">
    /// <see cref="ApiErrorCode.InvalidArgument"/> for a blank id or blocker,
    /// <see cref="ApiErrorCode.NotFound"/> for an issue or blocker the board does not hold, and
    /// <see cref="ApiErrorCode.Conflict"/> for an edge that would make a cycle or block the issue on
    /// itself.
    /// </exception>
    /// <ggop>board.set_issue_blocked_by</ggop>
    public static void SetIssueBlockedBy(string id, params string[] blockedBy) =>
        Internal.Wire.Check(Internal.Native.SetIssueBlockedBy(id, blockedBy));

    /// <summary>Remove an epic, keeping its issues and ungrouping them.</summary>
    /// <param name="id">The epic to drop, by its id.</param>
    /// <returns>how full the board now is.</returns>
    /// <exception cref="ApiException"><see cref="ApiErrorCode.NotFound"/> for an unknown id.</exception>
    /// <ggop>board.remove_epic</ggop>
    public static BoardUsage RemoveEpic(string id) => Remove(epic: true, id);

    /// <summary>Remove an issue, and every blocker edge pointing at it.</summary>
    /// <param name="id">The issue to drop, by its id.</param>
    /// <returns>how full the board now is.</returns>
    /// <exception cref="ApiException"><see cref="ApiErrorCode.NotFound"/> for an unknown id.</exception>
    /// <ggop>board.remove_issue</ggop>
    public static BoardUsage RemoveIssue(string id) => Remove(epic: false, id);

    /// <summary>Register a wait on an issue, and get back an acknowledgement.</summary>
    /// <remarks>
    /// <para>
    /// It does not block inside the program: it records the wait and returns at once, so the rest of
    /// the program still runs. Once the program has ended the run suspends — freeing this agent's
    /// slot for others — until the issue is terminal, and then resumes with which way it went.
    /// </para>
    /// <para>The issue an agent was assigned to implement is not one it may wait on.</para>
    /// </remarks>
    /// <param name="id">The issue to wait on.</param>
    /// <returns>an acknowledgement that the wait is registered.</returns>
    /// <exception cref="ApiException">
    /// <see cref="ApiErrorCode.InvalidArgument"/> for a blank id, or for the issue this agent was
    /// itself assigned, <see cref="ApiErrorCode.NotFound"/> for an id the board does not hold, and
    /// <see cref="ApiErrorCode.Unavailable"/> when the run has no board.
    /// </exception>
    /// <ggop>board.wait_for_issue</ggop>
    public static string WaitForIssue(string id)
    {
        Internal.Wire.Check(Internal.Native.WaitForIssue(id, out var acknowledgement));
        return acknowledgement;
    }

    // Two removals that lower one string and read back one board usage.
    private static BoardUsage Remove(bool epic, string id)
    {
        Internal.Wire.Check(Internal.Native.RemoveFromBoard(epic ? 1 : 0, id, out var board));
        return Internal.Wire.Board(board);
    }
}
