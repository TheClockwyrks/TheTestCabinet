using System.Collections.Generic;

namespace Gg;

/// <summary>
/// manage your own context window
/// </summary>
/// <remarks>
/// Four calls, and they are what you reach for when the window is filling up: drop file views you are
/// done with, move whole turns into the archive, search the archive for what you moved, and — when
/// none of that is enough — compact.
/// </remarks>
public static class context
{
    /// <inheritdoc cref="Internal.ObjectDirectory.List"/>
    public static IReadOnlyList<FunctionSummary> List() => Internal.ObjectDirectory.List("context");

    /// <summary>Drop file contents you have read out of your context window.</summary>
    /// <remarks>The files on disk are untouched; only your view of them goes.</remarks>
    /// <param name="path">
    /// The workspace path whose views to drop. Leave it out to drop every file view you hold.
    /// </param>
    /// <returns>what was actually freed, and from where.</returns>
    public static ReclaimReport EvictFileView(string? path = null)
    {
        Internal.Wire.Check(Internal.Native.EvictFileView(
            path,
            out var items,
            out var reclaimedTokens,
            out var paths,
            out var detail));
        return new ReclaimReport(items, reclaimedTokens, paths, detail);
    }

    /// <summary>Move whole turns out of your window, named by the turn numbers on your results.</summary>
    /// <remarks>
    /// Ranges are inclusive and may overlap. Your own messages in an archived turn are dropped; the
    /// results are kept and stay searchable with <see cref="SearchArchive"/>.
    /// </remarks>
    /// <param name="ranges">
    /// The spans of turns to archive. Each is inclusive at both ends, and a span whose ends are equal
    /// archives one turn.
    /// </param>
    /// <returns>what was actually freed.</returns>
    public static ReclaimReport ArchiveThread(params TurnRange[] ranges)
    {
        var starts = new uint[ranges.Length];
        var ends = new uint[ranges.Length];
        for (var index = 0; index < ranges.Length; index++)
        {
            starts[index] = ranges[index].From;
            ends[index] = ranges[index].To;
        }
        Internal.Wire.Check(Internal.Native.ArchiveThread(
            starts,
            ends,
            out var items,
            out var reclaimedTokens,
            out var paths,
            out var detail));
        return new ReclaimReport(items, reclaimedTokens, paths, detail);
    }

    /// <summary>Search everything you have archived, case-insensitively, by substring.</summary>
    /// <remarks>
    /// At most eight hits, most recent first. A search that matched nothing is an empty
    /// <see cref="ArchiveSearch.Hits"/>; a search with nothing to look in says so through
    /// <see cref="ArchiveSearch.ArchiveEmpty"/>, which is a different fact.
    /// </remarks>
    /// <param name="query">The substring to look for.</param>
    /// <returns>whether there was an archive at all, and what matched.</returns>
    public static ArchiveSearch SearchArchive(string query)
    {
        Internal.Wire.Check(Internal.Native.SearchArchive(
            query,
            out var archiveEmpty,
            out var sequences,
            out var roles,
            out var texts));
        var hits = new ArchiveHit[sequences.Length];
        for (var index = 0; index < sequences.Length; index++)
        {
            hits[index] = new ArchiveHit(sequences[index], (MessageRole)roles[index], texts[index]);
        }
        return new ArchiveSearch(archiveEmpty, hits);
    }

    /// <summary>Compact your context window: gg drops the detailed thread and restarts it from your summary.</summary>
    /// <remarks>
    /// <para>
    /// It is <b>registered, not performed</b>: the call validates and returns, your program carries on,
    /// and gg rewrites the window once the program has ended — a context reset has no shape inside the
    /// program whose context it resets. Calling it again simply replaces the request.
    /// </para>
    /// <para>
    /// Skills, memories and your task list are kept regardless. gg asks for this call when the window
    /// is full and refuses every other call until it is made, so it is available at all times.
    /// </para>
    /// </remarks>
    /// <param name="summary">
    /// Everything the next window has to start from: what you are doing, what you have found, and what
    /// is left.
    /// </param>
    /// <param name="files">Workspace paths to read freshly into the new window.</param>
    public static void Compact(string summary, params string[] files) =>
        Internal.Wire.Check(Internal.Native.Compact(summary, files));
}
