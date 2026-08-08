using System;

namespace Gg;

/// <summary>
/// Why a gg call failed, in the vocabulary a <c>catch</c> branches on.
/// </summary>
/// <remarks>
/// It is never derived from the wording of a message: every gg tool classifies its own failures
/// where it raises them, and this is that classification. Branch on it rather than on
/// <see cref="Exception.Message"/>, which is written for you to read and not for you to parse.
/// </remarks>
public enum ToolErrorCode
{
    /// <summary>The arguments were malformed, ill-typed, or out of range.</summary>
    InvalidArgument,

    /// <summary>
    /// The named file, skill, memory, task, epic, issue, subagent, stored program or documentation
    /// entry does not exist.
    /// </summary>
    NotFound,

    /// <summary>
    /// Well-formed, but in conflict with how things stand: an ambiguous edit, a dependency cycle, a
    /// duplicate id, a subagent that already returned.
    /// </summary>
    Conflict,

    /// <summary>
    /// gg refused the call — a rule about your own state. A memory you hold read-only, a call a
    /// pending compaction does not admit, a second succession in a turn that already declared one,
    /// or a hook that blocked it. A ceiling you ran into is <see cref="LimitExceeded"/> instead.
    /// </summary>
    Refused,

    /// <summary>
    /// The call exists and this run does not offer it to you: a tool outside this run's capability
    /// set, an ending your role does not declare, or a program library this agent does not keep.
    /// The recovery is to stop asking for it.
    /// </summary>
    Unavailable,

    /// <summary>
    /// A gg-side ceiling was hit: a shell timeout, a memory, task or board cap, the delegation depth
    /// cap, one of the view caps a program spends, or the run's wall-clock budget running out
    /// mid-program.
    /// </summary>
    LimitExceeded,

    /// <summary>The underlying I/O or process failed.</summary>
    IOError,

    /// <summary>
    /// The failure was not classified. Reserved for outcomes raised outside a tool implementation;
    /// no tool produces it.
    /// </summary>
    Other,
}

/// <summary>
/// The exception every gg call throws when it fails.
/// </summary>
/// <remarks>
/// <para>
/// A failure is thrown rather than returned because C# is an exception language: the common path
/// reads as a straight line, and the calls you expect to fail are the ones you wrap.
/// </para>
/// <code>
/// try
/// {
///     var notes = fs.ReadTextFile("NOTES.md");
///     view.OpenText("notes", notes);
/// }
/// catch (ToolException failure) when (failure.Code == ToolErrorCode.NotFound)
/// {
///     view.OpenText("notes", "there are no notes yet");
/// }
/// </code>
/// <para>
/// Let the ones you did not expect escape: gg reports which call failed, with the managed stack, and
/// the turn is recoverable.
/// </para>
/// </remarks>
public sealed class ToolException : Exception
{
    /// <summary>Build a failure. gg raises these; a program has no reason to.</summary>
    /// <param name="code">The failure class.</param>
    /// <param name="tool">The gg tool that failed.</param>
    /// <param name="message">The model-facing guidance.</param>
    public ToolException(ToolErrorCode code, string tool, string message)
        : base(message)
    {
        Code = code;
        Tool = tool;
    }

    /// <summary>
    /// The failure class, so a catch site branches on a value rather than on prose.
    /// </summary>
    public ToolErrorCode Code { get; }

    /// <summary>
    /// The gg tool that failed (<c>read_file</c>, <c>spawn_subagent</c>), so a catch site can report
    /// it without reading the message.
    /// </summary>
    public string Tool { get; }
}
