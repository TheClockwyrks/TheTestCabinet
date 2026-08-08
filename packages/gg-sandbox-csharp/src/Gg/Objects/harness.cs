using System.Collections.Generic;

namespace Gg;

/// <summary>
/// end your session
/// </summary>
/// <remarks>
/// Under responses-as-code every turn is a program, so there is no prose turn that could mean "I am
/// done". This is what means it, and it is the only thing that does.
/// </remarks>
public static class harness
{
    /// <inheritdoc cref="Internal.ObjectDirectory.List"/>
    public static IReadOnlyList<FunctionSummary> List() => Internal.ObjectDirectory.List("harness");

    /// <summary>Declare the work complete.</summary>
    /// <remarks>
    /// <para>
    /// It sets a flag on gg's side and <b>returns normally</b>. It does not stop your program, it
    /// throws nothing, and nothing after it is refused: the flag is what gg reads once the program has
    /// ended. Calling it again simply replaces the declaration.
    /// </para>
    /// <para>
    /// The flag is revoked if your program then fails — an uncaught exception, or a sandbox ceiling
    /// stopping it. A program that did not run to its end did not run the checks its summary claims,
    /// so the session carries on and you are told the ending was cancelled.
    /// </para>
    /// <para>Bound only for an agent doing work; a reviewer ends with <c>review.Approve</c> instead.</para>
    /// </remarks>
    /// <param name="summary">
    /// Your last word: for the root agent the run's final text, for a subagent its return value to
    /// whoever asked for the work. It must not be empty.
    /// </param>
    /// <exception cref="ToolException">
    /// <see cref="ToolErrorCode.Unavailable"/> when your role does not end this way, and
    /// <see cref="ToolErrorCode.InvalidArgument"/> for an empty summary.
    /// </exception>
    public static void Finish(string summary) => Internal.Wire.Check(Internal.Native.Finish(summary));
}
