using System.Collections.Generic;

namespace Gg;

/// <summary>Fetch a program already run, and hand a patched copy back to be run.</summary>
/// <remarks>gg keeps the source of every program this session ran.</remarks>
/// <ggmodule>programs</ggmodule>
public static partial class Programs
{
    /// <summary>List the programs this session has run, oldest first.</summary>
    /// <remarks>
    /// Each entry carries the shape of a program rather than its source. The list is empty before
    /// the first program has been recorded.
    /// </remarks>
    /// <returns>one summary per program the library still holds, the ones that failed included.</returns>
    /// <exception cref="ApiException">
    /// <see cref="ApiErrorCode.Unavailable"/> where this run keeps no program library.
    /// </exception>
    /// <ggop>programs.history</ggop>
    public static IReadOnlyList<ProgramSummary> History()
    {
        Internal.Wire.Check(Internal.Native.History(
            out var ids,
            out var turns,
            out var lines,
            out var chars,
            out var ok,
            out var errors));
        var summaries = new ProgramSummary[turns.Length];
        for (var index = 0; index < turns.Length; index++)
        {
            summaries[index] = new ProgramSummary(
                ids[index],
                turns[index],
                lines[index],
                chars[index],
                ok[index],
                errors[index]);
        }
        return summaries;
    }

    /// <summary>Fetch the exact source of one program that ran, by the id its acknowledgement carried.</summary>
    /// <remarks>
    /// What is kept under an id is the program that executed, including where one program handed
    /// another over. A rerun keeps the id of the submission it replaced.
    /// </remarks>
    /// <param name="id">The program's id, as its acknowledgement carried it.</param>
    /// <returns>that program's source.</returns>
    /// <exception cref="ApiException">
    /// <see cref="ApiErrorCode.NotFound"/> — naming the ids that are held — for an id that was never
    /// issued, or one whose program the library's retention has already dropped, and
    /// <see cref="ApiErrorCode.Unavailable"/> where this run keeps no program library.
    /// </exception>
    /// <ggop>programs.get</ggop>
    public static string Get(string id)
    {
        Internal.Wire.Check(Internal.Native.GetProgram(id, out var source));
        return source;
    }

    /// <summary>Hand gg a program to run in place of this one.</summary>
    /// <remarks>
    /// <para>
    /// It is registered rather than performed. The call returns and the rest of the program still
    /// runs; only once it has ended does gg compile and run what was handed over, under this
    /// submission's id. Everything the registering program did stands — its calls, its views.
    /// </para>
    /// <code>
    /// var previous = Programs.Get("k3p9");
    /// Programs.Rerun(previous.Replace("--release", "--debug"));
    /// </code>
    /// <para>
    /// The first call stands and a second is refused. The request is revoked if the program then
    /// fails.
    /// </para>
    /// </remarks>
    /// <param name="source">The program to run instead. Blank is refused.</param>
    /// <exception cref="ApiException">
    /// <see cref="ApiErrorCode.InvalidArgument"/> for a blank source,
    /// <see cref="ApiErrorCode.Refused"/> for a second call from the same program, and
    /// <see cref="ApiErrorCode.Unavailable"/> where this run keeps no program library.
    /// </exception>
    /// <ggop>programs.rerun</ggop>
    public static void Rerun(string source) => Internal.Wire.Check(Internal.Native.Rerun(source));
}
