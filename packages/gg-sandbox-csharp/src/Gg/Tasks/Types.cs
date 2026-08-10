// A task's status and budget, and the three-way text edit both work-item modules revise with.

namespace Gg;

public static partial class Tasks
{
    /// <summary>A three-way edit of an optional text field: leave it, empty it, or replace it.</summary>
    /// <remarks>
    /// <para>
    /// It exists so that clearing a description and setting it to the empty string stop being one
    /// request. The default is <see cref="Keep"/>, so an update that does not mention a description
    /// does not touch it. <c>Board.UpdateIssue</c> takes the same value for the same reason.
    /// </para>
    /// <code>
    /// Tasks.UpdateTask("build", description: Tasks.TextEdit.Set("cargo build --release"));
    /// Tasks.UpdateTask("build", description: Tasks.TextEdit.Clear);
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

        /// <summary>Leave the field exactly as it is, which is what a <c>TextEdit</c> is by default.</summary>
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
    /// A program that also writes <c>using System.Threading.Tasks;</c> reaches this one as
    /// <c>Gg.Tasks.TaskStatus</c>, since that namespace declares a type of the same name. There is
    /// nothing here to use it for: every call on this surface is synchronous.
    /// </remarks>
    public enum TaskStatus
    {
        /// <summary>Not started.</summary>
        Pending,

        /// <summary>Being worked on now.</summary>
        InProgress,

        /// <summary>Finished, so the tasks it blocked become actionable.</summary>
        Done,
    }

    /// <summary>How much of the task budget is used.</summary>
    /// <param name="Count">Tasks currently held.</param>
    /// <param name="MaxTasks">The most tasks this run allows.</param>
    public sealed record TaskUsage(uint Count, uint MaxTasks);
}
