/// manage your own context window
///
/// These are the only calls whose effect is on the conversation rather than on the workspace. They
/// are worth making from a program precisely because a program can decide *when* to: read a set of
/// files, extract what matters, then evict the views in the same turn.
public enum context: ApiObject {
    public static let ggObject = "context"

    /// The gg tools this object dispatches — see `fs.ggTools`.
    static let ggTools = [
        "evict_file_view", "archive_thread", "search_archive", "compact",
    ]

    /// Drop the contents of files you have read out of your context window, freeing the tokens they
    /// occupy, and report what that reclaimed.
    ///
    /// The files on disk are untouched — this forgets what you read, not what exists.
    ///
    /// - Parameter path: The file whose views to drop. Left out, it drops every file view you hold.
    /// - Returns: what the reclaim actually freed.
    @discardableResult
    public static func evictFileView(_ path: String? = nil) throws -> ReclaimReport {
        try withScratch { scratch in
            var ret = test_cabinet_gg_context_reclaim_report_t()
            var err = test_cabinet_gg_types_tool_error_t()
            let ok = withOptional(path.map { scratch.string($0) }) { path in
                test_cabinet_gg_context_evict_file_view(path, &ret, &err)
            }
            guard ok else { throw lift(failure: &err) }
            let report = ReclaimReport(wire: ret)
            test_cabinet_gg_context_reclaim_report_free(&ret)
            return report
        }
    }

    /// Move whole turns out of your context window and report what that reclaimed.
    ///
    /// Every result you are given carries a header with its turn number and roughly what holding it
    /// costs, so name the turns worth dropping. A span is a Swift `ClosedRange` and both of its ends
    /// are included, so `try context.archiveThread([4...19])` archives turns 4 through 19. Your own
    /// messages in an archived turn are dropped; the results are kept and stay searchable with
    /// `context.searchArchive`.
    ///
    /// - Parameter ranges: The inclusive spans of turn numbers to move out of your window. They may
    ///   overlap.
    /// - Returns: what the archive actually freed.
    /// - Throws: `ToolError` with `.invalidArgument` for a span whose ends are not turn numbers.
    @discardableResult
    public static func archiveThread(_ ranges: [ClosedRange<Int>]) throws -> ReclaimReport {
        try withScratch { scratch in
            var ranges = scratch.ranges(ranges)
            var ret = test_cabinet_gg_context_reclaim_report_t()
            var err = test_cabinet_gg_types_tool_error_t()
            guard test_cabinet_gg_context_archive_thread(&ranges, &ret, &err) else {
                throw lift(failure: &err)
            }
            let report = ReclaimReport(wire: ret)
            test_cabinet_gg_context_reclaim_report_free(&ret)
            return report
        }
    }

    /// Search archived history for a case-insensitive substring, most recent first, up to 8 hits.
    ///
    /// Check `archiveEmpty` before reading `hits`: it distinguishes "nothing has been archived yet"
    /// from "the search ran and matched nothing", so you do not archive again believing the first
    /// archive failed.
    ///
    /// - Parameter query: The substring to look for. Matching is case-insensitive.
    /// - Returns: whether anything is archived at all, and the matches.
    public static func searchArchive(_ query: String) throws -> ArchiveSearch {
        try withScratch { scratch in
            var query = scratch.string(query)
            var ret = test_cabinet_gg_context_archive_search_t()
            var err = test_cabinet_gg_types_tool_error_t()
            guard test_cabinet_gg_context_search_archive(&query, &ret, &err) else {
                throw lift(failure: &err)
            }
            let found = ArchiveSearch(wire: ret)
            test_cabinet_gg_context_archive_search_free(&ret)
            return found
        }
    }

    /// Compact your context window: the detailed thread is dropped and restarted from `summary`, plus
    /// a fresh read of each path in `files`.
    ///
    /// Your skills, memories and task list are kept as they are. You are asked to call this when your
    /// window is full, and every other call is refused until you do.
    ///
    /// It does NOT stop your program: it registers the request and returns, and the rewrite happens
    /// once your program has ended. Everything not in your summary and not in `files` is gone, so
    /// write the summary for your future self and name the files you will actually need in hand.
    ///
    /// - Parameters:
    ///   - summary: What your restarted window opens with. Write it for your future self: everything
    ///     not in it and not re-read from `files` is gone.
    ///   - files: The paths to read afresh into the restarted window. Empty by default, which reads
    ///     nothing back.
    /// - Throws: `ToolError` with `.refused` when a compaction is already in flight and this call is
    ///   not the one it asked for.
    public static func compact(summary: String, files: [String] = []) throws {
        try withScratch { scratch in
            var summary = scratch.string(summary)
            var files = scratch.list(files)
            var err = test_cabinet_gg_types_tool_error_t()
            guard test_cabinet_gg_context_compact(&summary, &files, &err) else {
                throw lift(failure: &err)
            }
        }
    }
}
