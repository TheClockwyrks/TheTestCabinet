using System.Collections.Generic;

namespace Gg;

/// <summary>
/// fetch a program you already ran, and hand a patched copy back to be run
/// </summary>
/// <remarks>
/// Under responses-as-code a whole turn is a program, so a trivial mistake in a long one costs the
/// whole program again. gg keeps the source of every program it ran for you: fetch one, patch it with
/// ordinary string work, and hand it back.
/// </remarks>
public static class programs
{
    /// <inheritdoc cref="Internal.ObjectDirectory.List"/>
    public static IReadOnlyList<FunctionSummary> List() => Internal.ObjectDirectory.List("programs");

    /// <summary>The programs you have run, oldest first.</summary>
    /// <remarks>
    /// Each entry carries the shape of a program rather than its source — a directory that inlined
    /// sixty lines per entry would put the whole session back into the one place that exists to avoid
    /// re-reading it. Empty before your first program has been recorded.
    /// </remarks>
    /// <returns>one summary per program you have run, oldest first.</returns>
    /// <exception cref="ToolException">
    /// <see cref="ToolErrorCode.Unavailable"/> when this agent keeps no program library.
    /// </exception>
    public static IReadOnlyList<ProgramSummary> History()
    {
        Internal.Wire.Check(Internal.Native.History(
            out var turns,
            out var lines,
            out var chars,
            out var ok,
            out var errors));
        var summaries = new ProgramSummary[turns.Length];
        for (var index = 0; index < turns.Length; index++)
        {
            summaries[index] = new ProgramSummary(
                turns[index],
                lines[index],
                chars[index],
                ok[index],
                errors[index]);
        }
        return summaries;
    }

    /// <summary>The exact source of one program, as it was run.</summary>
    /// <remarks>
    /// "As it was run" is the contract that matters: when a turn's program was itself handed over by an
    /// earlier one, what is kept is the program that executed rather than the few lines that asked for
    /// it. So fetching, patching and re-running composes.
    /// </remarks>
    /// <param name="turn">
    /// The turn to fetch, as <see cref="ProgramSummary.Turn"/> reports it. Leave it out for the most
    /// recent one.
    /// </param>
    /// <returns>that program's source.</returns>
    /// <exception cref="ToolException">
    /// <see cref="ToolErrorCode.NotFound"/> — naming the turns that are held — for a turn that ran no
    /// program, or one the library's retention has already dropped.
    /// </exception>
    public static string Get(uint? turn = null)
    {
        Internal.Wire.Check(Internal.Native.GetProgram(Internal.Wire.Slot(turn), out var source));
        return source;
    }

    /// <summary>Hand gg a program to run in place of this one.</summary>
    /// <remarks>
    /// <para>
    /// It is <b>registered, not performed</b>. The call returns and the rest of your program still
    /// runs; only when it has ended does gg compile and run what you handed over. Everything the
    /// registering program did stands — its calls, its views — and the program that runs next sees
    /// exactly the world it left behind.
    /// </para>
    /// <code>
    /// var previous = programs.Get();
    /// programs.Rerun(previous.Replace("--release", "--debug"));
    /// </code>
    /// <para>
    /// The first call stands and a second is refused: a silently replaced program is a change you
    /// cannot see. The request is revoked if your program then fails, on the same rule an ending is.
    /// </para>
    /// </remarks>
    /// <param name="source">The program to run instead. Blank is refused.</param>
    /// <exception cref="ToolException">
    /// <see cref="ToolErrorCode.InvalidArgument"/> for a blank source, and
    /// <see cref="ToolErrorCode.Refused"/> for a second call in one turn.
    /// </exception>
    public static void Rerun(string source) => Internal.Wire.Check(Internal.Native.Rerun(source));
}
