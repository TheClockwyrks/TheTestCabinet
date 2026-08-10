using System.Collections.Generic;

namespace Gg;

/// <summary>End the session, with a summary or with a reviewer's verdict.</summary>
/// <remarks>
/// Under responses-as-code every turn is a program, so there is no prose turn that could mean the
/// work is done. These calls mean it, and nothing else does. Which of them an agent has is decided
/// by its role: an agent doing work ends with <see cref="Finish"/>, and a reviewer returns a verdict
/// with <see cref="Approve"/> or <see cref="RequestChanges"/>.
/// </remarks>
/// <ggmodule>session</ggmodule>
public static partial class Session
{
    /// <inheritdoc cref="Internal.ModuleDirectory.List"/>
    public static IReadOnlyList<FunctionSummary> List() => Internal.ModuleDirectory.List(typeof(Session));

    /// <summary>Declare the work complete.</summary>
    /// <remarks>
    /// <para>
    /// It sets a flag on gg's side and returns normally. It does not stop the program, it throws
    /// nothing, and nothing after it is refused: gg reads the flag once the program has ended, and a
    /// second call simply replaces the declaration.
    /// </para>
    /// <para>
    /// The flag is revoked if the program then fails — an uncaught exception, or a sandbox ceiling
    /// stopping it. A program that did not run to its end did not run the checks its summary claims,
    /// so the session carries on and the ending is reported as cancelled.
    /// </para>
    /// </remarks>
    /// <param name="summary">
    /// The last word: for a root agent the run's final text, for a child its return value to whoever
    /// asked for the work. It must not be empty.
    /// </param>
    /// <exception cref="ToolException">
    /// <see cref="ToolErrorCode.Unavailable"/> when the agent's role does not end this way, and
    /// <see cref="ToolErrorCode.InvalidArgument"/> for an empty summary.
    /// </exception>
    /// <ggop>session.finish</ggop>
    public static void Finish(string summary) => Internal.Wire.Check(Internal.Native.Finish(summary));

    /// <summary>Declare the work under review acceptable.</summary>
    /// <remarks>
    /// It takes nothing, deliberately: an approval carries no further obligation, and a shape that
    /// demanded prose would be a shape gg had to read back. It ends the session under the same rules
    /// <see cref="Finish"/> does, and is revoked the same way.
    /// </remarks>
    /// <exception cref="ToolException">
    /// <see cref="ToolErrorCode.Unavailable"/> when the agent's role returns no verdict.
    /// </exception>
    /// <ggop>session.approve</ggop>
    public static void Approve() => Internal.Wire.Check(Internal.Native.Approve());

    /// <summary>Declare the work unacceptable, listing every change it needs.</summary>
    /// <remarks>
    /// A rejection with nothing to act on leaves the agent that has to fix the work no work to do,
    /// which is why the empty case is refused rather than represented. It ends the session under the
    /// same rules <see cref="Finish"/> does.
    /// </remarks>
    /// <param name="items">
    /// One entry per change, each saying what is wrong and what to change. At least one, and none of
    /// them blank.
    /// </param>
    /// <exception cref="ToolException">
    /// <see cref="ToolErrorCode.Unavailable"/> when the agent's role returns no verdict, and
    /// <see cref="ToolErrorCode.InvalidArgument"/> for an empty list or a blank entry.
    /// </exception>
    /// <ggop>session.request_changes</ggop>
    public static void RequestChanges(params string[] items) =>
        Internal.Wire.Check(Internal.Native.RequestChanges(items));
}
