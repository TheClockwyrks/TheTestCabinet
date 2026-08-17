// What the board hands back, the two enumerations an issue is revised with, and the wait a freshly
// filed issue can be put under.

namespace Gg;

public static partial class Board
{
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

    /// <summary>How an issue's epic grouping changes: leave it, detach it, or group it.</summary>
    /// <remarks>
    /// The default is <see cref="Keep"/>, so an update that does not mention the grouping does not
    /// change it — and detaching an issue and grouping it under nothing cannot be confused.
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

        /// <summary>Leave the grouping alone, which is what an <c>EpicAssignment</c> is by default.</summary>
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
    /// The epic's id — its upper-cased prefix, which its issues are numbered from and reference.
    /// </param>
    /// <param name="Board">How full the board now is.</param>
    public sealed record EpicCreated(string Id, BoardUsage Board);

    /// <summary>An issue the board just created.</summary>
    /// <param name="Id">The id the board assigned it, which every later reference uses.</param>
    /// <param name="Board">How full the board now is.</param>
    public sealed record IssueCreated(string Id, BoardUsage Board)
    {
        /// <summary>Register a wait on this issue, to be resumed once it goes terminal.</summary>
        /// <remarks>
        /// <see cref="WaitForIssue"/> with the id already supplied, for the common case where the
        /// issue that was just filed is the one to wait on. It records the wait and returns at once,
        /// so the rest of the program still runs and the suspension happens after it ends.
        /// </remarks>
        /// <returns>an acknowledgement that the wait is registered.</returns>
        /// <exception cref="ApiException">
        /// <see cref="ApiErrorCode.NotFound"/> when the board no longer holds the issue, which is
        /// the one way this can fail: the other refusals <see cref="WaitForIssue"/> documents cannot
        /// be reached from an issue that was just filed here.
        /// </exception>
        /// <ggop alias="true">board.wait_for_issue</ggop>
        public string Wait() => WaitForIssue(Id);
    }
}
