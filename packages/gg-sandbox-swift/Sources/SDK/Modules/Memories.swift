/// Durable memories, which survive a context compaction.
///
/// A run picks one of three memory strategies and binds only that strategy's functions, so
/// `memories.list()` is the honest answer to what memory can do here. The scratchpad keeps every
/// memory in the context window (`writeMemory`, `updateMemory`); the two file-shaped strategies keep
/// the contents outside it (`createMemory`, `readMemory`, `editMemory`), one behind an index that is
/// always in context and one behind `searchMemories`. `deleteMemory` is bound under all three.
///
/// Every mutation hands back the budget after it, so a program can decide whether to write another
/// memory by reading numbers rather than by parsing a sentence about them.
///
/// - ggmodule: memories
public enum memories: ModuleDirectory {
    /// The gg module this namespace is, which is what its directory is looked up by.
    public static let ggModule = "gg.memories"

    /// The gg tools this module dispatches — see `files.ggTools`.
    static let ggTools = [
        "write_memory", "update_memory", "create_memory", "read_memory", "edit_memory",
        "search_memories", "delete_memory",
    ]

    /// Record a durable memory that survives a context compaction.
    ///
    /// A memory may also carry code. `code` is a Swift file whose public declarations are bound at
    /// `lib.<name>` in every later program this session writes, so a helper got right once is never
    /// written again; `onUse` is a program gg runs the first time the memory comes into use, whose
    /// views arrive on the next turn. Neither is context: they cost no window, are never shown back,
    /// and count against no body limit.
    ///
    /// - Parameters:
    ///   - name: The memory's slug: letters, digits, `-`, `_` and `.`. Every other memory call takes
    ///     it, and no two memories may share one.
    ///   - description: A one-line description of what the memory holds. Where the run keeps a
    ///     memory index this is the memory's line in it, and so all that is visible until it is
    ///     read.
    ///   - body: The memory's contents.
    ///   - code: Reusable Swift, whose public declarations are bound at `lib.<name>` in every later
    ///     program. Left out, the memory carries none.
    ///   - onUse: A program to run once, when this memory first comes into use. Left out, the memory
    ///     carries none.
    /// - Returns: the memory budget after the write.
    /// - Throws: `core.ToolError` with `.conflict` on a duplicate name, and `.limitExceeded` when
    ///   the body would breach the run's caps — revising or deleting a memory is the way out, rather
    ///   than accruing more.
    /// - ggop: memories.write_memory
    @discardableResult
    public static func writeMemory(
        _ name: String, description: String, body: String,
        code: String? = nil, onUse: String? = nil
    ) throws -> MemoryUsage {
        try withScratch { scratch in
            var input = memoryInput(scratch, name, description, body, code, onUse)
            return try usage { ret, err in
                test_cabinet_gg_memories_write_memory(&input, ret, err)
            }
        }
    }

    /// Replace an existing memory's description and body, keyed on its slug.
    ///
    /// Its code and on-use program are replaced too — leaving one out clears the one the memory had.
    ///
    /// - Parameters:
    ///   - name: The slug of the memory to replace.
    ///   - description: The one-line description to replace the old one with.
    ///   - body: The contents to replace the old ones with.
    ///   - code: Reusable Swift to replace the memory's own with. Left out, it clears whatever the
    ///     memory carried.
    ///   - onUse: A program to run when the memory next comes into use. Left out, it clears whatever
    ///     the memory carried.
    /// - Returns: the memory budget after the write.
    /// - Throws: `core.ToolError` with `.notFound` when no memory has that name.
    /// - ggop: memories.update_memory
    @discardableResult
    public static func updateMemory(
        _ name: String, description: String, body: String,
        code: String? = nil, onUse: String? = nil
    ) throws -> MemoryUsage {
        try withScratch { scratch in
            var input = memoryInput(scratch, name, description, body, code, onUse)
            return try usage { ret, err in
                test_cabinet_gg_memories_update_memory(&input, ret, err)
            }
        }
    }

    /// Record a new memory whose contents stay out of the context window until they are read.
    ///
    /// It takes a slug, a one-line description — required where the run keeps an index, since that
    /// is the memory's line in it — and the initial contents.
    ///
    /// - Parameters:
    ///   - name: The memory's slug: letters, digits, `-`, `_` and `.`.
    ///   - description: A one-line description of what the memory holds, which is its line in the
    ///     index.
    ///   - body: The memory's initial contents, which stay out of the context window until they are
    ///     read.
    ///   - code: Reusable Swift, bound at `lib.<name>` from the read that loads this memory onwards.
    ///     Left out, the memory carries none.
    ///   - onUse: A program to run once, on that same first read. Left out, the memory carries none.
    /// - Returns: the memory budget after the write.
    /// - Throws: `core.ToolError` with `.conflict` on a duplicate slug, and `.limitExceeded` when
    ///   the contents, or the index entry, would breach a limit.
    /// - ggop: memories.create_memory
    @discardableResult
    public static func createMemory(
        _ name: String, description: String, body: String,
        code: String? = nil, onUse: String? = nil
    ) throws -> MemoryUsage {
        try withScratch { scratch in
            var input = memoryInput(scratch, name, description, body, code, onUse)
            return try usage { ret, err in
                test_cabinet_gg_memories_create_memory(&input, ret, err)
            }
        }
    }

    /// Read one memory's full contents by slug, which is the only thing that brings them into
    /// context.
    ///
    /// A memory that carries code loads that code on being read: the reply names the `lib.<key>` it
    /// is bound at, and it stays bound for the rest of the session.
    ///
    /// - Parameter name: The memory's slug.
    /// - Returns: the memory's contents.
    /// - Throws: `core.ToolError` with `.notFound` when no memory has that slug.
    /// - ggop: memories.read_memory
    public static func readMemory(_ name: String) throws -> String {
        try withScratch { scratch in
            var name = scratch.string(name)
            var ret = sandbox_string_t()
            var err = test_cabinet_gg_types_tool_error_t()
            guard test_cabinet_gg_memories_read_memory(&name, &ret, &err) else {
                throw lift(failure: &err)
            }
            let body = lift(ret)
            sandbox_string_free(&ret)
            return body
        }
    }

    /// Revise a memory in place, replacing the one exact occurrence of some text with something
    /// else.
    ///
    /// Appending is done by quoting the last line and replacing it with itself plus what is being
    /// added.
    ///
    /// - Parameters:
    ///   - name: The slug of the memory to revise.
    ///   - replacing: The exact text to find in its contents. It must appear exactly once.
    ///   - with: The text to put in its place.
    /// - Returns: the memory budget after the edit.
    /// - Throws: `core.ToolError` with `.notFound` when the text does not appear, `.conflict` when
    ///   it appears more than once, `.limitExceeded` when the result would be too long, and
    ///   `.invalidArgument` when the edit would leave the memory empty — deleting it is the way to
    ///   do that.
    /// - ggop: memories.edit_memory
    @discardableResult
    public static func editMemory(
        _ name: String, replacing search: String, with replacement: String
    ) throws -> MemoryUsage {
        try withScratch { scratch in
            var edit = test_cabinet_gg_memories_memory_edit_t(
                name: scratch.string(name),
                search: scratch.string(search),
                replace: scratch.string(replacement))
            return try usage { ret, err in
                test_cabinet_gg_memories_edit_memory(&edit, ret, err)
            }
        }
    }

    /// Find the memories mentioning any of `keywords`, best first.
    ///
    /// Plain case-insensitive substring matching over each memory's slug, description and contents,
    /// ranked by how many distinct keywords a memory mentions and then by how often. Several
    /// specific words rank better than one sentence; `memories.readMemory` is what fetches a hit
    /// worth having in full. A search that matches nothing is an empty array.
    ///
    /// - Parameter keywords: The words to look for. Several specific words rank better than one
    ///   sentence, because a memory is ranked by how many of them it mentions.
    /// - Returns: the matching memories, best first.
    /// - Throws: `core.ToolError` with `.invalidArgument` when every keyword is empty.
    /// - ggop: memories.search_memories
    public static func searchMemories(_ keywords: [String]) throws -> [MemoryHit] {
        try withScratch { scratch in
            var keywords = scratch.list(keywords)
            var ret = test_cabinet_gg_memories_list_memory_hit_t()
            var err = test_cabinet_gg_types_tool_error_t()
            guard test_cabinet_gg_memories_search_memories(&keywords, &ret, &err) else {
                throw lift(failure: &err)
            }
            let hits = lift(ret.ptr, ret.len) { MemoryHit(wire: $0) }
            test_cabinet_gg_memories_list_memory_hit_free(&ret)
            return hits
        }
    }

    /// Evict a memory by name, freeing room in the budget.
    ///
    /// - Parameter name: The memory's slug.
    /// - Returns: the memory budget after the eviction.
    /// - Throws: `core.ToolError` with `.notFound` when no memory has that name.
    /// - ggop: memories.delete_memory
    @discardableResult
    public static func deleteMemory(_ name: String) throws -> MemoryUsage {
        try withScratch { scratch in
            var name = scratch.string(name)
            return try usage { ret, err in
                test_cabinet_gg_memories_delete_memory(&name, ret, err)
            }
        }
    }

    /// How much of the run's durable-memory budget is used, after the call that returned it.
    ///
    /// Every maximum is optional: each limit can be turned off, and a run's memory strategy applies
    /// only some of them, so `nil` means nothing bounds that axis — which is worth checking before
    /// subtracting.
    public struct MemoryUsage: Sendable {
        /// Memories currently held.
        public let count: Int
        /// The most memories this run allows, if it limits the count.
        public let maxCount: Int?
        /// Characters of body currently held, across all memories.
        public let totalChars: Int
        /// The most characters of body this run allows in total, if it limits the aggregate.
        public let maxTotalChars: Int?
        /// Characters the memory index occupies, under a run that keeps one.
        public let indexChars: Int?
        /// The most characters the index may occupy, if it is limited.
        public let maxIndexChars: Int?

        init(wire: test_cabinet_gg_memories_memory_usage_t) {
            count = Int(wire.count)
            maxCount = wire.max_count.is_some ? Int(wire.max_count.val) : nil
            totalChars = Int(wire.total_chars)
            maxTotalChars = wire.max_total_chars.is_some ? Int(wire.max_total_chars.val) : nil
            indexChars = wire.index_chars.is_some ? Int(wire.index_chars.val) : nil
            maxIndexChars = wire.max_index_chars.is_some ? Int(wire.max_index_chars.val) : nil
        }
    }

    /// One memory `memories.searchMemories` matched, and the numbers it was ranked by.
    public struct MemoryHit: Sendable {
        /// The memory's slug — what `memories.readMemory` takes.
        public let name: String
        /// Its description, or `""` when it was created without one.
        public let description: String
        /// How many distinct keywords it matched — the primary ranking.
        public let matched: Int
        /// How many times those keywords occur in it — the tiebreak.
        public let occurrences: Int
        /// A short window of the memory around its first match.
        public let excerpt: String

        init(wire: test_cabinet_gg_memories_memory_hit_t) {
            name = lift(wire.name)
            description = lift(wire.description)
            matched = Int(wire.matched)
            occurrences = Int(wire.occurrences)
            excerpt = lift(wire.excerpt)
        }
    }
}

extension memories.MemoryHit {
    /// Read this hit's memory in full, with its slug already supplied.
    ///
    /// `memories.readMemory` for the common case where the search result is in hand.
    ///
    /// - Returns: the memory's contents.
    /// - Throws: `core.ToolError` with `.notFound` when the memory has since been deleted.
    /// - ggop-alias: memories.read_memory
    public func read() throws -> String {
        try memories.readMemory(name)
    }
}

/// The wire record the three writes share, built once rather than three times.
private func memoryInput(
    _ scratch: Scratch, _ name: String, _ description: String, _ body: String,
    _ code: String?, _ onUse: String?
) -> test_cabinet_gg_memories_memory_input_t {
    test_cabinet_gg_memories_memory_input_t(
        name: scratch.string(name),
        description: scratch.string(description),
        body: scratch.string(body),
        code: scratch.optional(code),
        on_use: scratch.optional(onUse))
}

/// The `result<memory-usage, tool-error>` every mutation in this module hands back.
private func usage(
    _ call: (
        UnsafeMutablePointer<test_cabinet_gg_memories_memory_usage_t>,
        UnsafeMutablePointer<test_cabinet_gg_types_tool_error_t>
    ) -> Bool
) throws -> memories.MemoryUsage {
    var ret = test_cabinet_gg_memories_memory_usage_t()
    var err = test_cabinet_gg_types_tool_error_t()
    guard call(&ret, &err) else { throw lift(failure: &err) }
    return memories.MemoryUsage(wire: ret)
}
