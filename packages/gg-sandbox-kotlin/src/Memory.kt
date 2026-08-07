import org.teavm.jso.JSObject

/**
 * The `memory` object: durable notes that survive context compaction.
 *
 * A run picks one of three memory strategies, and only that strategy's functions are bound — so
 * `memory.list()` is the honest answer to "what can I do with memory here?". The scratchpad keeps every
 * memory in the context window (`writeMemory`/`updateMemory`); the two file-shaped strategies keep the
 * contents *outside* it (`createMemory`/`readMemory`/`editMemory`), one behind an index that is always
 * in context and one behind `searchMemories`. `deleteMemory` is bound under all three.
 *
 * Every mutation hands back the budget after it, so a program can decide whether to write another
 * memory by reading numbers rather than by parsing a sentence about them.
 *
 * The two code halves a memory may carry are the writes' own `code` and `onUse` arguments rather than a
 * value to build first, which is what default arguments are for.
 */
public class Memory internal constructor() : ApiObject("memory") {
    override fun target(): JSObject? = memoryObject()

    /**
     * Record a durable memory that survives context compaction, and hand back how much of the memory
     * budget is now used.
     *
     * A memory's code costs you no window, is never shown back to you, and counts against no body limit:
     * a module is bound at `lib.<name>` in every later program you write, so a helper you get right once
     * you never write again, and an on-use script runs the first time the memory comes into use with its
     * views reaching you on your next turn.
     *
     * @param name The memory's slug: letters, digits, `-`, `_` and `.`. It is what every other memory
     *   call takes, and no two memories may share one.
     * @param description A one-line description of what the memory holds. Where the run keeps a memory
     *   index this is the memory's line in it, and so all you see of the memory until you read it.
     * @param body The memory's contents.
     * @param code A Kotlin file whose public top-level functions are bound at `lib.<name>` for the rest
     *   of your session.
     * @param onUse A program gg runs the first time the memory comes into use; whatever it shows you
     *   arrives on your next turn.
     * @return how much of the memory budget is now used
     * @throws ToolError `CONFLICT` on a duplicate name, and `LIMIT_EXCEEDED` when the body would breach
     *   the run's caps — revise or delete a memory rather than accruing more.
     */
    public fun writeMemory(
        name: String,
        description: String,
        body: String,
        code: String? = null,
        onUse: String? = null,
    ): MemoryUsage = write("write_memory", "writeMemory", name, description, body, code, onUse)

    /**
     * Replace an existing memory's description and body, keyed on its name, and hand back the memory
     * budget.
     *
     * Its code is replaced too — leaving `code` and `onUse` out clears whatever the memory carried.
     *
     * @param name The slug of the memory to replace.
     * @param description The one-line description to replace the old one with.
     * @param body The contents to replace the old ones with.
     * @param code A Kotlin file whose public top-level functions are bound at `lib.<name>`, replacing
     *   whatever module the memory carried.
     * @param onUse A program gg runs the first time the memory comes into use, replacing whatever script
     *   the memory carried.
     * @return how much of the memory budget is now used
     * @throws ToolError `NOT_FOUND` when no memory has that name.
     */
    public fun updateMemory(
        name: String,
        description: String,
        body: String,
        code: String? = null,
        onUse: String? = null,
    ): MemoryUsage = write("update_memory", "updateMemory", name, description, body, code, onUse)

    /**
     * Record a new memory whose contents are kept OUT of your context window until you read them, and
     * hand back the memory budget.
     *
     * @param name The memory's slug: letters, digits, `-`, `_` and `.`.
     * @param description A one-line description of what the memory holds, which is its line in the
     *   index.
     * @param body The memory's initial contents. They stay out of your context window until you read
     *   them.
     * @param code A Kotlin file whose public top-level functions are bound at `lib.<name>` once you read
     *   the memory.
     * @param onUse A program gg runs on that first read; whatever it shows you arrives on your next
     *   turn.
     * @return how much of the memory budget is now used
     * @throws ToolError `CONFLICT` on a duplicate slug, and `LIMIT_EXCEEDED` when the contents, or the
     *   index entry, would breach a limit.
     */
    public fun createMemory(
        name: String,
        description: String,
        body: String,
        code: String? = null,
        onUse: String? = null,
    ): MemoryUsage = write("create_memory", "createMemory", name, description, body, code, onUse)

    /**
     * Read one memory's full contents, by slug — the only thing that brings them into your context.
     *
     * If the memory carries code, reading it also loads that code: the reply names the `lib.<key>` it is
     * bound at, and it stays bound for the rest of your session.
     *
     * @param name The memory's slug.
     * @return the memory's contents
     * @throws ToolError `NOT_FOUND` when no memory has that slug.
     */
    public fun readMemory(name: String): String =
        ggAsString(
            ggCall("read_memory", target(), owner, "readMemory", ggArgs(ggText(name))),
        )

    /**
     * Revise a memory in place by replacing the one exact occurrence of `search` with `replace`, and
     * hand back the memory budget.
     *
     * Append by quoting the last line and replacing it with itself plus what you are adding.
     *
     * @param name The slug of the memory to revise.
     * @param search The exact text to find in its contents. It must appear exactly once.
     * @param replace The text to put in its place.
     * @return how much of the memory budget is now used
     * @throws ToolError `NOT_FOUND` when the text does not appear, `CONFLICT` when it appears more than
     *   once, `LIMIT_EXCEEDED` when the result would be too long, and `INVALID_ARGUMENT` when the edit
     *   would leave the memory empty — delete it instead.
     */
    public fun editMemory(name: String, search: String, replace: String): MemoryUsage {
        val edit = ggRecord()
        ggSet(edit, "name", ggText(name))
        ggSet(edit, "search", ggText(search))
        ggSet(edit, "replace", ggText(replace))
        return Read.memoryUsage(
            ggCall("edit_memory", target(), owner, "editMemory", ggArgs(edit)),
        )
    }

    /**
     * Find the memories mentioning any of `keywords`, best first.
     *
     * Plain case-insensitive substring matching over each memory's slug, description and contents, ranked
     * by how many of your keywords a memory mentions and then by how often. Pass several specific words
     * rather than one sentence, then `memory.readMemory` the hits worth having in full. A search that
     * matches nothing is an empty list.
     *
     * @param keywords The words to look for. Several specific words rank better than one sentence,
     *   because a memory is ranked by how many of them it mentions.
     * @return every memory that mentioned one, best first
     * @throws ToolError `INVALID_ARGUMENT` when every keyword is empty.
     */
    public fun searchMemories(vararg keywords: String): List<MemoryHit> =
        Read.memoryHits(
            ggCall(
                "search_memories",
                target(),
                owner,
                "searchMemories",
                ggArgs(ggTexts(keywords.asIterable())),
            ),
        )

    /**
     * Evict a memory by name, freeing room in the budget, and hand back what is left in use.
     *
     * @param name The memory's slug.
     * @return how much of the memory budget is now used
     * @throws ToolError `NOT_FOUND` when no memory has that name.
     */
    public fun deleteMemory(name: String): MemoryUsage =
        Read.memoryUsage(
            ggCall("delete_memory", target(), owner, "deleteMemory", ggArgs(ggText(name))),
        )

    /** The memory record every write of one takes, as the guest's own function wants it. */
    private fun write(
        tool: String,
        called: String,
        slug: String,
        description: String,
        body: String,
        code: String?,
        onUse: String?,
    ): MemoryUsage {
        val written = ggRecord()
        ggSet(written, "name", ggText(slug))
        ggSet(written, "description", ggText(description))
        ggSet(written, "body", ggText(body))
        if (code != null) {
            ggSet(written, "code", ggText(code))
        }
        if (onUse != null) {
            ggSet(written, "onUse", ggText(onUse))
        }
        return Read.memoryUsage(ggCall(tool, target(), owner, called, ggArgs(written)))
    }
}
