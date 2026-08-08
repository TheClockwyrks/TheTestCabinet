/// durable memories that survive context compaction
///
/// A run picks one of three memory strategies, and only that strategy's functions are bound — so
/// `memory.list()` is the honest answer to "what can I do with memory here?". The scratchpad keeps
/// every memory in the context window (`writeMemory`/`updateMemory`); the two file-shaped strategies
/// keep the contents *outside* it (`createMemory`/`readMemory`/`editMemory`), one behind an index
/// that is always in context and one behind `searchMemories`. `deleteMemory` is bound under all
/// three.
///
/// Every mutation hands back the budget after it, so a program can decide whether to write another
/// memory by reading numbers rather than by parsing a sentence about them.
public enum memory: ApiObject {
    public static let ggObject = "memory"

    /// The gg tools this object dispatches — see `fs.ggTools`.
    static let ggTools = [
        "write_memory", "update_memory", "create_memory", "read_memory", "edit_memory",
        "search_memories", "delete_memory",
    ]

    /// Record a durable memory that survives context compaction, and hand back how much of the
    /// memory budget is now used.
    ///
    /// A memory may also carry **code**. `code` is a Swift file whose public declarations are bound
    /// at `lib.<name>` in every later program you write, so a helper you get right once you never
    /// write again; `onUse` is a program gg runs the first time the memory comes into use, whose
    /// views reach you on your next turn. Neither is context — they cost you no window, are never
    /// shown back to you, and count against no body limit — and both are bounded on their own.
    ///
    /// - Parameters:
    ///   - name: The memory's slug: letters, digits, `-`, `_` and `.`. It is what every other memory
    ///     call takes, and no two memories may share one.
    ///   - description: A one-line description of what the memory holds. Where the run keeps a memory
    ///     index this is the memory's line in it, and so all you see of the memory until you read it.
    ///   - body: The memory's contents.
    ///   - code: Reusable Swift, whose public declarations are bound at `lib.<name>` in every later
    ///     program of yours. Left out, the memory carries none.
    ///   - onUse: A program to run once, when this memory first comes into use. Left out, the memory
    ///     carries none.
    /// - Returns: the memory budget after the write.
    /// - Throws: `ToolError` with `.conflict` on a duplicate name, and `.limitExceeded` when the body
    ///   would breach the run's caps — revise or delete a memory rather than accruing more.
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

    /// Replace an existing memory's description and body, keyed on its `name`, and hand back the
    /// memory budget.
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
    /// - Throws: `ToolError` with `.notFound` when no memory has that name.
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

    /// Record a new memory whose contents are kept OUT of your context window until you read them,
    /// and hand back the memory budget.
    ///
    /// Give it a slug, a one-line description — required where the run keeps an index, since that is
    /// the memory's line in it — and the initial contents.
    ///
    /// - Parameters:
    ///   - name: The memory's slug: letters, digits, `-`, `_` and `.`.
    ///   - description: A one-line description of what the memory holds, which is its line in the
    ///     index.
    ///   - body: The memory's initial contents, which stay out of your context window until you read
    ///     them.
    ///   - code: Reusable Swift, bound at `lib.<name>` from the read that loads this memory onwards.
    ///     Left out, the memory carries none.
    ///   - onUse: A program to run once, on that same first read. Left out, the memory carries none.
    /// - Returns: the memory budget after the write.
    /// - Throws: `ToolError` with `.conflict` on a duplicate slug, and `.limitExceeded` when the
    ///   contents, or the index entry, would breach a limit.
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

    /// Read one memory's full contents, by slug — the only thing that brings them into your context.
    ///
    /// If the memory carries code, reading it also loads that code: the reply names the `lib.<key>`
    /// it is bound at, and it stays bound for the rest of your session.
    ///
    /// - Parameter name: The memory's slug.
    /// - Returns: the memory's contents.
    /// - Throws: `ToolError` with `.notFound` when no memory has that slug.
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

    /// Revise a memory in place by replacing the one exact occurrence of `search` with `replacement`,
    /// and hand back the memory budget.
    ///
    /// Append by quoting the last line and replacing it with itself plus what you are adding.
    ///
    /// - Parameters:
    ///   - name: The slug of the memory to revise.
    ///   - replacing: The exact text to find in its contents. It must appear exactly once.
    ///   - with: The text to put in its place.
    /// - Returns: the memory budget after the edit.
    /// - Throws: `ToolError` with `.notFound` when the text does not appear, `.conflict` when it
    ///   appears more than once, `.limitExceeded` when the result would be too long, and
    ///   `.invalidArgument` when the edit would leave the memory empty — delete it instead.
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
    /// ranked by how many of your keywords a memory mentions and then by how often. Pass several
    /// specific words rather than one sentence, then `memory.readMemory` the hits worth having in
    /// full. A search that matches nothing is an empty array.
    ///
    /// - Parameter keywords: The words to look for. Several specific words rank better than one
    ///   sentence, because a memory is ranked by how many of them it mentions.
    /// - Returns: the matching memories, best first.
    /// - Throws: `ToolError` with `.invalidArgument` when every keyword is empty.
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

    /// Evict a memory by name, freeing room in the budget, and hand back what is left in use.
    ///
    /// - Parameter name: The memory's slug.
    /// - Returns: the memory budget after the eviction.
    /// - Throws: `ToolError` with `.notFound` when no memory has that name.
    @discardableResult
    public static func deleteMemory(_ name: String) throws -> MemoryUsage {
        try withScratch { scratch in
            var name = scratch.string(name)
            return try usage { ret, err in
                test_cabinet_gg_memories_delete_memory(&name, ret, err)
            }
        }
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

/// The `result<memory-usage, tool-error>` every mutation on this object hands back.
private func usage(
    _ call: (
        UnsafeMutablePointer<test_cabinet_gg_memories_memory_usage_t>,
        UnsafeMutablePointer<test_cabinet_gg_types_tool_error_t>
    ) -> Bool
) throws -> MemoryUsage {
    var ret = test_cabinet_gg_memories_memory_usage_t()
    var err = test_cabinet_gg_types_tool_error_t()
    guard call(&ret, &err) else { throw lift(failure: &err) }
    return MemoryUsage(wire: ret)
}
