namespace Gg;

/// <summary>Reclaim room in the context window.</summary>
/// <remarks>
/// Three reclaims: dropping file views, moving whole turns into a searchable archive, and restarting
/// the window from a summary.
/// </remarks>
/// <ggmodule>context</ggmodule>
public static partial class Context
{
    /// <summary>Drop file contents already read out of the context window.</summary>
    /// <remarks>The files on disk are untouched; only the views of them go.</remarks>
    /// <param name="path">The workspace path whose views to drop. Left out, every file view goes.</param>
    /// <returns>what was actually freed, and from where.</returns>
    /// <exception cref="ApiException">
    /// <see cref="ApiErrorCode.InvalidArgument"/> for a path that is given but empty.
    /// </exception>
    /// <ggop>context.evict_file_view</ggop>
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

    /// <summary>Move whole turns out of the window, named by the turn numbers on each result.</summary>
    /// <remarks>
    /// Ranges are inclusive and may overlap. Assistant messages in an archived turn are dropped; the
    /// results are kept and stay searchable.
    /// </remarks>
    /// <param name="ranges">
    /// The spans of turns to archive. Each is inclusive at both ends, and a span whose ends are
    /// equal archives one turn.
    /// </param>
    /// <returns>what was actually freed.</returns>
    /// <exception cref="ApiException">
    /// <see cref="ApiErrorCode.InvalidArgument"/> for an empty list, too many spans at once, or a
    /// span that ends before it starts.
    /// </exception>
    /// <ggop>context.archive_thread</ggop>
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

    /// <summary>Search everything archived so far, case-insensitively, by substring.</summary>
    /// <remarks>
    /// At most eight hits, most recent first. A search that matched nothing is an empty
    /// <see cref="ArchiveSearch.Hits"/>; a search with nothing to look in says so through
    /// <see cref="ArchiveSearch.ArchiveEmpty"/>, which is a different fact.
    /// </remarks>
    /// <param name="query">The substring to look for.</param>
    /// <returns>whether there was an archive at all, and what matched.</returns>
    /// <exception cref="ApiException">
    /// <see cref="ApiErrorCode.InvalidArgument"/> for an empty query.
    /// </exception>
    /// <ggop>context.search_archive</ggop>
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

    /// <summary>Compact the window: gg drops the detailed thread and restarts it from a summary.</summary>
    /// <remarks>
    /// <para>
    /// It is registered rather than performed: the call validates and returns, the program carries
    /// on, and gg rewrites the window once the program has ended. A second call replaces the
    /// request.
    /// </para>
    /// <para>
    /// Skills, memories and the task list are kept. The call is available at all times, including
    /// while a compaction is already in flight.
    /// </para>
    /// </remarks>
    /// <param name="summary">
    /// Everything the next window has to start from: what is being done, what has been found, and
    /// what is left.
    /// </param>
    /// <param name="files">Workspace paths to read freshly into the new window.</param>
    /// <exception cref="ApiException">
    /// <see cref="ApiErrorCode.InvalidArgument"/> for a blank summary.
    /// </exception>
    /// <ggop>context.compact</ggop>
    public static void Compact(string summary, params string[] files) =>
        Internal.Wire.Check(Internal.Native.Compact(summary, files));
}
