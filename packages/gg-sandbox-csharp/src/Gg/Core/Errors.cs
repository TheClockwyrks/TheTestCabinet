using System;

namespace Gg;

/// <summary>Why a gg call failed, in the vocabulary a <c>catch</c> branches on.</summary>
/// <remarks>
/// A code is never derived from the wording of a message: every gg tool classifies its own failures
/// where it raises them, and this is that classification. Branching on it is stable in a way that
/// branching on <see cref="Exception.Message"/> is not.
/// </remarks>
/// <ggmodule>core</ggmodule>
public enum ToolErrorCode
{
    /// <summary>The arguments were malformed, ill-typed, or out of range.</summary>
    InvalidArgument,

    /// <summary>The named file, skill, memory, task, epic, issue, subagent or program is not there.</summary>
    NotFound,

    /// <summary>Well-formed, and in conflict with how things stand.</summary>
    /// <remarks>
    /// An ambiguous edit, a dependency cycle, a duplicate id, a child agent that has already
    /// returned.
    /// </remarks>
    Conflict,

    /// <summary>gg refused the call because of a rule about the agent's own state.</summary>
    /// <remarks>
    /// A read-only memory, a call a pending compaction does not admit, a second succession in one
    /// turn, or a hook that blocked it. A ceiling that was reached is
    /// <see cref="LimitExceeded"/> instead.
    /// </remarks>
    Refused,

    /// <summary>The call exists and this run does not offer it to this agent.</summary>
    /// <remarks>
    /// A tool outside the run's capability set, an ending the agent's role does not declare, or a
    /// program library this agent does not keep. The recovery is to stop asking for it.
    /// </remarks>
    Unavailable,

    /// <summary>A gg-side ceiling was reached.</summary>
    /// <remarks>
    /// A shell timeout, a memory, task or board cap, the delegation depth cap, a view cap a program
    /// spends, or the run's wall-clock budget running out mid-program.
    /// </remarks>
    LimitExceeded,

    /// <summary>The underlying input, output or process failed.</summary>
    IOError,

    /// <summary>The failure was not classified.</summary>
    /// <remarks>No tool produces it; it is reserved for outcomes raised outside a tool implementation.</remarks>
    Other,
}

/// <summary>The exception every gg call throws when it fails.</summary>
/// <remarks>
/// <para>
/// A failure is thrown rather than returned because C# is an exception language: the common path
/// reads as a straight line, and only the calls expected to fail are wrapped.
/// </para>
/// <code>
/// try
/// {
///     Views.OpenText("notes", Files.ReadTextFile("NOTES.md"));
/// }
/// catch (ToolException failure) when (failure.Code == ToolErrorCode.NotFound)
/// {
///     Views.OpenText("notes", "there are no notes yet");
/// }
/// </code>
/// <para>
/// An unexpected one is best left to escape: gg reports which call failed, with the managed stack,
/// and the turn is recoverable.
/// </para>
/// </remarks>
/// <ggmodule>core</ggmodule>
public sealed class ToolException : Exception
{
    /// <summary>Build a failure, which gg raises and a program has no reason to.</summary>
    /// <param name="code">The failure class.</param>
    /// <param name="tool">The call that failed, by the operation's key.</param>
    /// <param name="message">The model-facing guidance.</param>
    public ToolException(ToolErrorCode code, string tool, string message)
        : base(message)
    {
        Code = code;
        Tool = tool;
    }

    /// <summary>The failure class, so a catch site branches on a value rather than on prose.</summary>
    public ToolErrorCode Code { get; }

    /// <summary>The call that failed, by the key of the operation this program reached for.</summary>
    /// <remarks>
    /// <c>read_file</c> for <c>Files.ReadFile</c>, <c>read_text_file</c> for
    /// <c>Files.ReadTextFile</c>.
    /// </remarks>
    public string Tool { get; }
}
