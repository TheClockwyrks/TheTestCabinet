using System.Collections.Generic;

namespace Gg;

/// <summary>
/// return your verdict on the work you are reviewing
/// </summary>
/// <remarks>
/// One of these two ends a reviewer's session, and gg reads the verdict straight off which one you
/// called. An agent doing work has neither, and ends with <c>harness.Finish</c> instead.
/// </remarks>
public static class review
{
    /// <inheritdoc cref="Internal.ObjectDirectory.List"/>
    public static IReadOnlyList<FunctionSummary> List() => Internal.ObjectDirectory.List("review");

    /// <summary>Declare the work under review acceptable.</summary>
    /// <remarks>
    /// It takes nothing, deliberately: an approval carries no further obligation, and a shape that
    /// demanded prose would be a shape gg had to read back. It ends the session under the same rules
    /// <c>harness.Finish</c> does — it returns normally, and it is revoked if your program then fails.
    /// </remarks>
    /// <exception cref="ToolException">
    /// <see cref="ToolErrorCode.Unavailable"/> when your role is not the one that returns a verdict.
    /// </exception>
    public static void Approve() => Internal.Wire.Check(Internal.Native.Approve());

    /// <summary>Declare the work unacceptable, listing every change that must be made before it can be accepted.</summary>
    /// <remarks>
    /// Ends the session under the same rules <c>harness.Finish</c> does. A rejection with nothing to
    /// act on gives the agent that has to fix the work no work to do, which is why the empty case is
    /// refused rather than represented.
    /// </remarks>
    /// <param name="items">
    /// One entry per change, each saying what is wrong and what to change. At least one, and none of
    /// them blank.
    /// </param>
    /// <exception cref="ToolException">
    /// <see cref="ToolErrorCode.Unavailable"/> when your role is not the one that returns a verdict,
    /// and <see cref="ToolErrorCode.InvalidArgument"/> for an empty list or a blank entry.
    /// </exception>
    public static void RequestChanges(params string[] items) =>
        Internal.Wire.Check(Internal.Native.RequestChanges(items));
}
