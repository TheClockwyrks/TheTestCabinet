using System.Collections.Generic;

namespace Gg;

/// <summary>
/// the epic/issue board — decompose work into dispatchable issues
/// </summary>
/// <remarks>
/// An issue is heavyweight and self-contained: it says what is in scope, what is not, and how it will
/// be judged done, and gg dispatches it to the agent it names. That is what makes it different from a
/// task, which is a note to yourself.
/// </remarks>
public static class project
{
    /// <inheritdoc cref="Internal.ObjectDirectory.List"/>
    public static IReadOnlyList<FunctionSummary> List() => Internal.ObjectDirectory.List("project");

    /// <summary>Create an epic to group related issues under.</summary>
    /// <param name="prefix">
    /// A three to six letter prefix naming the epic. Upper-cased it becomes the epic's id, and the
    /// stem its issues are numbered from — <c>auth</c> gives <c>AUTH</c>, then <c>AUTH-1</c>,
    /// <c>AUTH-2</c>.
    /// </param>
    /// <param name="title">What the epic is called.</param>
    /// <param name="description">What the epic covers.</param>
    /// <returns>the id the prefix resolved to, and how full the board now is.</returns>
    /// <exception cref="ToolException">
    /// <see cref="ToolErrorCode.Conflict"/> for a prefix already in use, and
    /// <see cref="ToolErrorCode.LimitExceeded"/> at the epic cap.
    /// </exception>
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

    /// <summary>Create a self-contained, dispatchable issue, and get back the id the board assigned it.</summary>
    /// <remarks>
    /// <para>
    /// The three scope arguments are what makes an issue dispatchable: the agent that picks it up sees
    /// them and nothing of your conversation, so anything it needs has to be in them.
    /// </para>
    /// <code>
    /// var created = project.CreateIssue(
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
    /// <param name="agent">
    /// The agent gg dispatches this issue to. It must be one you may spawn — your system prompt lists
    /// them.
    /// </param>
    /// <param name="description">An overview, where the title does not carry it.</param>
    /// <param name="blockedBy">Ids of issues that must finish first; a cycle is refused.</param>
    /// <param name="epicId">The epic to group it under.</param>
    /// <param name="reviewers">
    /// The agents that must approve this issue's work, drawn from the same set as
    /// <paramref name="agent"/>. Required when this run's reviewers feature is on, and left out
    /// otherwise.
    /// </param>
    /// <returns>the id the board assigned, and how full the board now is.</returns>
    /// <exception cref="ToolException">
    /// <see cref="ToolErrorCode.InvalidArgument"/> for an agent you may not spawn,
    /// <see cref="ToolErrorCode.Conflict"/> for a blocker cycle, and
    /// <see cref="ToolErrorCode.LimitExceeded"/> at the issue cap.
    /// </exception>
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
    /// Everything is optional and what you leave out is left alone. The description and the epic
    /// grouping are three-way values rather than nullable ones, so that clearing and leaving are
    /// different requests.
    /// </remarks>
    /// <param name="id">The issue to revise.</param>
    /// <param name="title">A new title.</param>
    /// <param name="description">A three-way edit of the description: keep it, clear it, or set it.</param>
    /// <param name="inScope">New scope.</param>
    /// <param name="outOfScope">New out-of-scope.</param>
    /// <param name="completionCriteria">New completion criteria.</param>
    /// <param name="status">A new status.</param>
    /// <param name="epic">A change of epic grouping: keep it, ungroup it, or group it under an epic.</param>
    /// <exception cref="ToolException">
    /// <see cref="ToolErrorCode.NotFound"/> for an unknown id, and
    /// <see cref="ToolErrorCode.InvalidArgument"/> when you changed nothing at all.
    /// </exception>
    public static void UpdateIssue(
        string id,
        string? title = null,
        TextEdit description = default,
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
    /// The issue ids that must finish first, replacing whatever was there. An empty list clears every
    /// blocker.
    /// </param>
    /// <exception cref="ToolException">
    /// <see cref="ToolErrorCode.Conflict"/> for an edge that would make a cycle.
    /// </exception>
    public static void SetIssueBlockedBy(string id, params string[] blockedBy) =>
        Internal.Wire.Check(Internal.Native.SetIssueBlockedBy(id, blockedBy));

    /// <summary>Remove an epic. Its issues are kept, and ungrouped.</summary>
    /// <param name="id">The epic to drop, by its id.</param>
    /// <returns>how full the board now is.</returns>
    /// <exception cref="ToolException"><see cref="ToolErrorCode.NotFound"/> for an unknown id.</exception>
    public static BoardUsage RemoveEpic(string id) => Remove(epic: true, id);

    /// <summary>Remove an issue, and every blocker edge pointing at it.</summary>
    /// <param name="id">The issue to drop, by its id.</param>
    /// <returns>how full the board now is.</returns>
    /// <exception cref="ToolException"><see cref="ToolErrorCode.NotFound"/> for an unknown id.</exception>
    public static BoardUsage RemoveIssue(string id) => Remove(epic: false, id);

    /// <summary>Register a wait on an issue, and get back an acknowledgement.</summary>
    /// <remarks>
    /// <para>
    /// It does <b>not</b> block inside your program: it records the wait and returns at once, so the
    /// rest of your program still runs. Once the program has ended the run suspends — freeing this
    /// agent's slot for others — until the issue is terminal, and then resumes and tells you which way
    /// it went.
    /// </para>
    /// <para>You cannot wait on the issue you were assigned to implement.</para>
    /// </remarks>
    /// <param name="id">The issue to wait on.</param>
    /// <returns>an acknowledgement that the wait is registered.</returns>
    /// <exception cref="ToolException">
    /// <see cref="ToolErrorCode.Refused"/> for the issue you were assigned, and
    /// <see cref="ToolErrorCode.NotFound"/> for an unknown id.
    /// </exception>
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
