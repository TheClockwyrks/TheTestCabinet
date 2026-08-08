namespace Gg;

/// <summary>What a finished process reported.</summary>
/// <param name="ExitCode">
/// The exit status, or <c>null</c> when a signal terminated the process. A non-zero code is an
/// ordinary result to branch on, not a failure of the call.
/// </param>
/// <param name="Output">
/// Merged standard output then standard error, tail-truncated at gg's 16 KiB cap — or, when this run
/// offloads shell output, at its configured ceiling, followed by a note naming the files holding the
/// command's full output.
/// </param>
/// <param name="Truncated">Whether the cap cut <paramref name="Output"/>: the head was dropped and the tail kept.</param>
public sealed record ShellOutput(int? ExitCode, string Output, bool Truncated);

/// <summary>
/// A three-way edit of an optional text field: leave it, empty it, or replace it.
/// </summary>
/// <remarks>
/// <para>
/// It exists so that "clear the description" and "set the description to the empty string" stop
/// being the same request. The default is <see cref="Keep"/>, so an update that does not mention a
/// description does not touch it.
/// </para>
/// <code>
/// tasks.UpdateTask("build", description: TextEdit.Set("cargo build --release"));
/// tasks.UpdateTask("build", description: TextEdit.Clear);
/// </code>
/// </remarks>
public readonly struct TextEdit
{
    /// <summary>Which of the three this is: 0 keep, 1 clear, 2 set.</summary>
    internal readonly int Kind;

    /// <summary>The replacement text, for a <see cref="Set"/>.</summary>
    internal readonly string? Text;

    private TextEdit(int kind, string? text)
    {
        Kind = kind;
        Text = text;
    }

    /// <summary>Leave the field exactly as it is. This is what a <c>TextEdit</c> is by default.</summary>
    public static TextEdit Keep => default;

    /// <summary>Empty the field.</summary>
    public static TextEdit Clear => new(1, null);

    /// <summary>Replace the field with this text.</summary>
    /// <param name="text">What the field should say instead.</param>
    /// <returns>an edit that replaces the field.</returns>
    public static TextEdit Set(string text) => new(2, text);
}

/// <summary>Where a task stands.</summary>
/// <remarks>
/// If your program also writes <c>using System.Threading.Tasks;</c>, spell this one
/// <c>Gg.TaskStatus</c> — that namespace declares a type of the same name. There is nothing here to
/// use it for, though: every call on this surface is synchronous.
/// </remarks>
public enum TaskStatus
{
    /// <summary>Not started.</summary>
    Pending,

    /// <summary>Being worked on now.</summary>
    InProgress,

    /// <summary>Finished. Tasks it blocked become actionable once all of their blockers are done.</summary>
    Done,
}

/// <summary>How much of the task budget is used.</summary>
/// <param name="Count">Tasks currently held.</param>
/// <param name="MaxTasks">The most tasks this run allows.</param>
public sealed record TaskUsage(uint Count, uint MaxTasks);

/// <summary>Where an issue stands.</summary>
public enum IssueStatus
{
    /// <summary>Not started, and dispatchable once its blockers are done.</summary>
    Open,

    /// <summary>Being worked on now.</summary>
    InProgress,

    /// <summary>Finished.</summary>
    Done,
}

/// <summary>
/// How an issue's epic grouping changes: leave it, detach it, or group it under an epic.
/// </summary>
/// <remarks>
/// The default is <see cref="Keep"/>, so an update that does not mention the grouping does not
/// change it — and "detach this issue" and "group it under nothing" cannot be confused.
/// </remarks>
public readonly struct EpicAssignment
{
    /// <summary>Which of the three this is: 0 keep, 1 ungroup, 2 set.</summary>
    internal readonly int Kind;

    /// <summary>The epic to group under, for a <see cref="Set"/>.</summary>
    internal readonly string? EpicId;

    private EpicAssignment(int kind, string? epicId)
    {
        Kind = kind;
        EpicId = epicId;
    }

    /// <summary>Leave the grouping alone. This is what an <c>EpicAssignment</c> is by default.</summary>
    public static EpicAssignment Keep => default;

    /// <summary>Detach the issue from whatever epic it is under.</summary>
    public static EpicAssignment Ungroup => new(1, null);

    /// <summary>Group the issue under an epic.</summary>
    /// <param name="epicId">The epic's id — the upper-cased prefix it was created with.</param>
    /// <returns>an assignment that groups the issue under that epic.</returns>
    public static EpicAssignment Set(string epicId) => new(2, epicId);
}

/// <summary>How much of the board budget is used.</summary>
/// <param name="Epics">Epics currently held.</param>
/// <param name="MaxEpics">The most epics this run allows.</param>
/// <param name="Issues">Issues currently held.</param>
/// <param name="MaxIssues">The most issues this run allows.</param>
public sealed record BoardUsage(uint Epics, uint MaxEpics, uint Issues, uint MaxIssues);

/// <summary>An epic the board just created.</summary>
/// <param name="Id">
/// The epic's id — its upper-cased prefix (<c>auth</c> becomes <c>AUTH</c>), which its issues are
/// numbered from and which they reference as their epic.
/// </param>
/// <param name="Board">How full the board now is.</param>
public sealed record EpicCreated(string Id, BoardUsage Board);

/// <summary>An issue the board just created.</summary>
/// <param name="Id">The id the board assigned it (<c>AUTH-1</c>) — the handle every later reference uses.</param>
/// <param name="Board">How full the board now is.</param>
public sealed record IssueCreated(string Id, BoardUsage Board);
