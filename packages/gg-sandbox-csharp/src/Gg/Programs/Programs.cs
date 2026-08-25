using System.Collections.Generic;

namespace Gg;

/// <summary>Fetch a program already run, and hand a patched copy back to be run.</summary>
/// <remarks>
/// Under responses-as-code a whole turn is a program, so a trivial mistake in a long one costs the
/// whole program again. gg keeps the source of every program it ran: fetch one, patch it with
/// ordinary string work, and hand it back.
/// </remarks>
/// <ggmodule>programs</ggmodule>
public static partial class Programs
{
    /// <summary>List the programs this session has run, oldest first.</summary>
    /// <remarks>
    /// Each entry carries the shape of a program rather than its source: a directory that inlined
    /// sixty lines per entry would put the whole session back into the one place that exists to
    /// avoid re-reading it. It is empty before the first program has been recorded.
    /// </remarks>
    /// <returns>one summary per program the library still holds, the ones that failed included.</returns>
    /// <exception cref="ApiException">
    /// <see cref="ApiErrorCode.Unavailable"/> when this agent keeps no program library.
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
    /// As it was run is the contract that matters: where a submission's program was itself handed
    /// over by the one before it, what is kept under the submission's id is the program that executed
    /// rather than the few lines that asked for it. So fetching, patching and re-running composes,
    /// and a rerun keeps the id of the submission it replaced.
    /// </remarks>
    /// <param name="id">
    /// The program's id, as its acknowledgement carried it and as <see cref="ProgramSummary.Id"/>
    /// reports it.
    /// </param>
    /// <returns>that program's source, ready to patch and hand to <see cref="Rerun"/>.</returns>
    /// <exception cref="ApiException">
    /// <see cref="ApiErrorCode.NotFound"/> — naming the ids that are held — for an id this agent
    /// was never issued, or one whose program the library's retention has already dropped, and
    /// <see cref="ApiErrorCode.Unavailable"/> when this agent keeps no program library.
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
    /// submission's id. Everything the
    /// registering program did stands — its calls, its views — and the program that runs next sees
    /// exactly the world it left behind.
    /// </para>
    /// <code>
    /// var previous = Programs.Get("k3p9");
    /// Programs.Rerun(previous.Replace("--release", "--debug"));
    /// </code>
    /// <para>
    /// The first call stands and a second is refused, because a silently replaced program is a
    /// change nobody can see. The request is revoked if the program then fails, on the same rule an
    /// ending is.
    /// </para>
    /// </remarks>
    /// <param name="source">The program to run instead. Blank is refused.</param>
    /// <exception cref="ApiException">
    /// <see cref="ApiErrorCode.InvalidArgument"/> for a blank source,
    /// <see cref="ApiErrorCode.Refused"/> for a second call from the same program, and
    /// <see cref="ApiErrorCode.Unavailable"/> when this agent keeps no program library.
    /// </exception>
    /// <ggop>programs.rerun</ggop>
    public static void Rerun(string source) => Internal.Wire.Check(Internal.Native.Rerun(source));
}
