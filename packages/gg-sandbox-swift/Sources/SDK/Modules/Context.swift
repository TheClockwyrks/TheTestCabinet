/// Manage the agent's own context window.
///
/// These are the only calls whose effect is on the conversation rather than on the workspace. They
/// are worth making from a program precisely because a program can decide *when* to: read a set of
/// files, extract what matters, then evict the views, all in one turn.
///
/// - ggmodule: context
public enum context: ModuleDirectory {
    /// The gg module this namespace is, which is what its directory is looked up by.
    public static let ggModule = "gg.context"

    /// The gg tools this module dispatches — see `files.ggTools`.
    static let ggTools = [
        "evict_file_view", "archive_thread", "search_archive", "compact",
    ]

    /// Drop the contents of files that were read out of the context window, freeing their tokens.
    ///
    /// The files on disk are untouched: this forgets what was read, not what exists.
    ///
    /// - Parameter path: The file whose views to drop. Left out, it drops every file view held.
    /// - Returns: what the reclaim actually freed.
    /// - ggop: context.evict_file_view
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

    /// Move whole turns out of the context window and report what that reclaimed.
    ///
    /// Every result carries a header with its turn number and roughly what holding it costs, which
    /// is what names the turns worth dropping. A span is a Swift `ClosedRange` and both of its ends
    /// are included, so `try context.archiveThread([4...19])` archives turns 4 through 19. The
    /// agent's own messages in an archived turn are dropped; the results are kept and stay
    /// searchable with `context.searchArchive`.
    ///
    /// - Parameter ranges: The inclusive spans of turn numbers to move out of the window. They may
    ///   overlap.
    /// - Returns: what the archive actually freed.
    /// - Throws: `core.ToolError` with `.invalidArgument` for an empty list, too many spans at once,
    ///   or a span that ends before it starts.
    /// - ggop: context.archive_thread
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
    /// `archiveEmpty` is worth checking before `hits`: it distinguishes "nothing has been archived
    /// yet" from "the search ran and matched nothing", so a program does not archive again believing
    /// the first archive failed.
    ///
    /// - Parameter query: The substring to look for. Matching is case-insensitive.
    /// - Returns: whether anything is archived at all, and the matches.
    /// - ggop: context.search_archive
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

    /// Compact the context window: the detailed thread is dropped and restarted from `summary`.
    ///
    /// A fresh read of each path in `files` is added to the restarted window. Skills, memories and
    /// the task list are kept as they are. gg asks for this call when the window is full, and
    /// refuses every other call until it arrives.
    ///
    /// It does not stop the program: it registers the request and returns, and the rewrite happens
    /// once the program has ended. Everything not in the summary and not in `files` is gone, so the
    /// summary is written for the agent that comes after and `files` names what it will need in
    /// hand.
    ///
    /// - Parameters:
    ///   - summary: What the restarted window opens with. Everything not in it and not re-read from
    ///     `files` is gone.
    ///   - files: The paths to read afresh into the restarted window. Empty by default, which reads
    ///     nothing back.
    /// - Throws: `core.ToolError` with `.refused` when a compaction is already in flight and this
    ///   call is not the one it asked for.
    /// - ggop: context.compact
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

    /// What a context reclaim actually freed from the live context window.
    public struct ReclaimReport: Sendable {
        /// Context items dropped from the live window.
        public let items: Int
        /// Approximately how many tokens that freed.
        public let reclaimedTokens: Int
        /// The workspace paths whose views were evicted. Empty for an archive.
        public let paths: [String]
        /// The prose summary of what was reclaimed.
        public let detail: String

        init(wire: test_cabinet_gg_context_reclaim_report_t) {
            items = Int(wire.items)
            reclaimedTokens = Int(wire.reclaimed_tokens)
            paths = lift(wire.paths)
            detail = lift(wire.detail)
        }
    }

    /// What `context.searchArchive` found.
    public struct ArchiveSearch: Sendable {
        /// Nothing has been archived yet, so there was nothing to search.
        ///
        /// Deliberately distinct from a search that ran and matched nothing, so a program does not
        /// archive again believing the first archive failed.
        public let archiveEmpty: Bool
        /// The matches, most recent first, at most 8.
        public let hits: [ArchiveHit]

        init(wire: test_cabinet_gg_context_archive_search_t) {
            archiveEmpty = wire.archive_empty
            hits = lift(wire.hits.ptr, wire.hits.len) { ArchiveHit(wire: $0) }
        }
    }

    /// One archived message that matched a search.
    public struct ArchiveHit: Sendable {
        /// The archived message's sequence number.
        public let seq: Int
        /// Who said it.
        public let role: MessageRole
        /// The message text.
        public let text: String

        init(wire: test_cabinet_gg_context_archive_hit_t) {
            seq = Int(wire.seq)
            role = MessageRole(wire: wire.role)
            text = lift(wire.text)
        }
    }

    /// Who said an archived message.
    public enum MessageRole: Sendable {
        /// The system prompt.
        case system
        /// A turn's input to the agent — a result, a view, or an operator's instruction.
        case user
        /// Something the agent said.
        case assistant
        /// A tool result, on a session that made tool calls rather than writing programs.
        case tool

        init(wire: test_cabinet_gg_context_message_role_t) {
            switch Int32(wire) {
            case TEST_CABINET_GG_CONTEXT_MESSAGE_ROLE_SYSTEM: self = .system
            case TEST_CABINET_GG_CONTEXT_MESSAGE_ROLE_USER: self = .user
            case TEST_CABINET_GG_CONTEXT_MESSAGE_ROLE_ASSISTANT: self = .assistant
            default: self = .tool
            }
        }
    }
}
