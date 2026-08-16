/**
 * Durable notes that survive a context compaction.
 *
 * A run picks one of three memory strategies and binds only that strategy's functions, so what this
 * module offers is the honest answer to what memory can do here. The scratchpad keeps every
 * memory in the context window; the two file-shaped strategies keep the contents outside it, one
 * behind an index that is always in context and one behind a keyword search. Deleting is bound under
 * all three.
 *
 * Every mutation hands back the budget after it, so a program decides whether to write another memory
 * by reading numbers rather than by parsing a sentence about them.
 *
 * @ggmodule memories
 */
package gg.memories

import gg.core.ToolError
import gg.internal.Read
import gg.internal.ggCall
import gg.internal.ggRecord
import gg.internal.ggText
import gg.internal.ggTexts


/**
 * Record a durable memory that survives context compaction.
 *
 * A memory's code costs no window, is never shown back, and counts against no body limit: a module is
 * compiled into every later program this session writes and reached at `lib.<key>.<name>`, so a
 * helper got right once is never written again, and an on-use script runs the first time the memory comes into use with its
 * views arriving on the next turn.
 *
 * @ggop memories.write_memory
 * @param name The memory's slug: letters, digits, `-`, `_` and `.`. Every other memory call takes it,
 *   and no two memories may share one.
 * @param description A one-line description of what the memory holds, which is its line in a memory
 *   index where the run keeps one.
 * @param body The memory's contents.
 * @param code A Kotlin file whose public top-level functions are reached at `lib.<name>.<export>`
 *   from every later program this session writes.
 * @param onUse A program gg runs the first time the memory comes into use, whose views arrive on the
 *   next turn.
 * @return how much of the memory budget is now used
 * @throws ToolError `CONFLICT` on a duplicate name, and `LIMIT_EXCEEDED` when the body would breach
 *   the run's caps.
 */
public fun writeMemory(
    name: String,
    description: String,
    body: String,
    code: String? = null,
    onUse: String? = null,
): MemoryUsage = write("memories.write_memory", name, description, body, code, onUse)

/**
 * Replace an existing memory's description and body, keyed on its name.
 *
 * The code is replaced too, so leaving `code` and `onUse` out clears whatever the memory carried.
 *
 * @ggop memories.update_memory
 * @param name The slug of the memory to replace.
 * @param description The one-line description to replace the old one with.
 * @param body The contents to replace the old ones with.
 * @param code A Kotlin file whose public top-level functions are reached at `lib.<name>.<export>`,
 *   replacing whatever module the memory carried.
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
): MemoryUsage = write("memories.update_memory", name, description, body, code, onUse)

/**
 * Record a new memory whose contents stay out of the context window until they are read.
 *
 * This is the write the two file-shaped strategies bind, and the distinction from the scratchpad's
 * write is where the contents live rather than what they say.
 *
 * @ggop memories.create_memory
 * @param name The memory's slug: letters, digits, `-`, `_` and `.`.
 * @param description A one-line description of what the memory holds, which is its line in the index.
 * @param body The memory's initial contents, which stay out of the context window until they are
 *   read.
 * @param code A Kotlin file whose public top-level functions are reached at `lib.<name>.<export>`
 *   once the memory is read.
 * @param onUse A program gg runs on that first read, whose views arrive on the next turn.
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
): MemoryUsage = write("memories.create_memory", name, description, body, code, onUse)

/**
 * Read one memory's full contents by slug, which is what brings them into the context window.
 *
 * A memory that carries code is also loaded by the read: the reply names the `lib.<key>` it is reached
 * through, and it stays bound for the rest of the session.
 *
 * @ggop memories.read_memory
 * @param name The memory's slug.
 * @return the memory's contents
 * @throws ToolError `NOT_FOUND` when no memory has that slug.
 */
public fun readMemory(name: String): String =
    ggCall("memories.read_memory", ggText(name)).text()

/**
 * Revise a memory in place, replacing the one exact occurrence of `search` with `replace`.
 *
 * Appending is quoting the last line and replacing it with itself plus whatever is being added.
 *
 * @ggop memories.edit_memory
 * @param name The slug of the memory to revise.
 * @param search The exact text to find in its contents. It must appear exactly once.
 * @param replace The text to put in its place.
 * @return how much of the memory budget is now used
 * @throws ToolError `NOT_FOUND` when the text does not appear, `CONFLICT` when it appears more than
 *   once, `LIMIT_EXCEEDED` when the result would be too long, and `INVALID_ARGUMENT` when the edit
 *   would leave the memory empty.
 */
public fun editMemory(name: String, search: String, replace: String): MemoryUsage {
    val edit =
        ggRecord()
            .put("name", ggText(name))
            .put("search", ggText(search))
            .put("replace", ggText(replace))
    return Read.memoryUsage(ggCall("memories.edit_memory", edit))
}

/**
 * Find the memories mentioning any of `keywords`, best first.
 *
 * Plain case-insensitive substring matching over each memory's slug, description and contents, ranked
 * by how many of the keywords a memory mentions and then by how often. Several specific words rank
 * better than one sentence. A search that matches nothing is an empty list.
 *
 * @ggop memories.search_memories
 * @param keywords The words to look for. Several specific words rank better than one sentence,
 *   because a memory is ranked by how many of them it mentions.
 * @return every memory that mentioned one, best first
 * @throws ToolError `INVALID_ARGUMENT` when every keyword is empty.
 */
public fun searchMemories(vararg keywords: String): List<MemoryHit> =
    Read.memoryHits(ggCall("memories.search_memories", ggTexts(keywords.asIterable())))

/**
 * Evict a memory by name, freeing room in the budget.
 *
 * @ggop memories.delete_memory
 * @param name The memory's slug.
 * @return how much of the memory budget is now used
 * @throws ToolError `NOT_FOUND` when no memory has that name.
 */
public fun deleteMemory(name: String): MemoryUsage =
    Read.memoryUsage(ggCall("memories.delete_memory", ggText(name)))

/** The `memory-input` record every write of one takes, as gg's own WIT declares it. */
private fun write(
    op: String,
    slug: String,
    description: String,
    body: String,
    code: String?,
    onUse: String?,
): MemoryUsage {
    val written =
        ggRecord()
            .put("name", ggText(slug))
            .put("description", ggText(description))
            .put("body", ggText(body))
            .put("code", ggText(code))
            .put("on-use", ggText(onUse))
    return Read.memoryUsage(ggCall(op, written))
}

/**
 * How much of the run's durable-memory budget is used, after the call that returned it.
 *
 * Every maximum is optional: each limit can be turned off, and a run's memory strategy applies only
 * some of them, so a `null` means nothing bounds that axis.
 *
 * @property count Memories currently held.
 * @property maxCount The most memories this run allows, if it limits the count.
 * @property totalChars Characters of body currently held, across all memories.
 * @property maxTotalChars The most characters of body this run allows in total, if it limits the
 *   aggregate.
 * @property indexChars Characters the memory index occupies, under a run that keeps one.
 * @property maxIndexChars The most characters the index may occupy, if it is limited.
 */
public data class MemoryUsage(
    val count: Int,
    val maxCount: Int?,
    val totalChars: Int,
    val maxTotalChars: Int?,
    val indexChars: Int?,
    val maxIndexChars: Int?,
)

/**
 * One memory a keyword search matched, and the numbers it was ranked by.
 *
 * @property name The memory's slug, which is what reading it takes.
 * @property description Its description, or `""` when it was created without one.
 * @property matched How many of the distinct keywords it matched, which is the primary ranking.
 * @property occurrences How many times those keywords occur in it, which is the tiebreak.
 * @property excerpt A short window of the memory around its first match.
 */
public data class MemoryHit(
    val name: String,
    val description: String,
    val matched: Int,
    val occurrences: Int,
    val excerpt: String,
) {
    /**
     * Read this hit's memory in full, with its slug already supplied.
     *
     * `gg.memories.readMemory` for the common case where the search result is in hand, written as a
     * member so that the value carrying the slug is what the call hangs off.
     *
     * @ggalias memories.read_memory
     * @return the memory's contents
     * @throws ToolError `NOT_FOUND` when the memory has been deleted since the search.
     */
    public fun read(): String = readMemory(name)
}
