namespace Gg;

/// <summary>End the session, with a summary or with a reviewer's verdict.</summary>
/// <remarks>
/// Ending the session takes one of these calls and nothing else does. Which of them is bound depends
/// on the role this run was given.
/// </remarks>
/// <ggmodule>session</ggmodule>
public static partial class Session
{
    /// <summary>Declare the work complete.</summary>
    /// <remarks>
    /// <para>
    /// It sets a flag on gg's side and returns normally. It does not stop the program, it throws
    /// nothing, and nothing after it is refused: gg reads the flag once the program has ended, and a
    /// second call simply replaces the declaration.
    /// </para>
    /// <para>
    /// The flag is revoked if the program then fails — an uncaught exception, or a sandbox ceiling
    /// stopping it. The session then carries on and the ending is reported as cancelled.
    /// </para>
    /// </remarks>
    /// <param name="summary">
    /// The last word: for a root agent the run's final text, for a child its return value to whoever
    /// asked for the work. It must not be empty.
    /// </param>
    /// <exception cref="ApiException">
    /// <see cref="ApiErrorCode.Unavailable"/> where this run does not end this way, and
    /// <see cref="ApiErrorCode.InvalidArgument"/> for an empty summary.
    /// </exception>
    /// <ggop>session.finish</ggop>
    public static void Finish(string summary) => Internal.Wire.Check(Internal.Native.Finish(summary));

    /// <summary>Declare the work under review acceptable.</summary>
    /// <remarks>
    /// It sets a flag gg reads once the program has ended, stops nothing, and is revoked if the
    /// program then fails.
    /// </remarks>
    /// <exception cref="ApiException">
    /// <see cref="ApiErrorCode.Unavailable"/> where this run returns no verdict.
    /// </exception>
    /// <ggop>session.approve</ggop>
    public static void Approve() => Internal.Wire.Check(Internal.Native.Approve());

    /// <summary>Declare the work unacceptable, listing every change it needs.</summary>
    /// <remarks>
    /// It sets a flag gg reads once the program has ended, stops nothing, and is revoked if the
    /// program then fails.
    /// </remarks>
    /// <param name="items">
    /// One entry per change, each saying what is wrong and what to change. At least one, and none of
    /// them blank.
    /// </param>
    /// <exception cref="ApiException">
    /// <see cref="ApiErrorCode.Unavailable"/> where this run returns no verdict, and
    /// <see cref="ApiErrorCode.InvalidArgument"/> for an empty list or a blank entry.
    /// </exception>
    /// <ggop>session.request_changes</ggop>
    public static void RequestChanges(params string[] items) =>
        Internal.Wire.Check(Internal.Native.RequestChanges(items));
}
