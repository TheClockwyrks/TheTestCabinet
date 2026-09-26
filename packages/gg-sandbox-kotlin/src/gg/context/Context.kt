/**
 * Managing the context window.
 *
 * These calls act on the conversation rather than on the workspace.
 *
 * @ggmodule context
 */
package gg.context

import gg.core.ApiError
import gg.internal.Read
import gg.internal.Value
import gg.internal.ggCall
import gg.internal.ggList
import gg.internal.ggNumber
import gg.internal.ggRecord
import gg.internal.ggRun
import gg.internal.ggText
import gg.internal.ggTexts


/**
 * Drop the contents of files that were read out of the context window, and report what that
 * reclaimed.
 *
 * The files on disk are untouched: this forgets what was read, not what exists.
 *
 * @ggop context.evict_file_view
 * @param path The file whose views to drop. Left out, every file that was read is dropped.
 * @return what the eviction reclaimed
 * @throws ApiError `INVALID_ARGUMENT` for a path that is given but empty; leaving it out
 *   altogether is how every file view is dropped. A path with no view open frees nothing and is not
 *   a failure.
 */
public fun evictFileView(path: String? = null): ReclaimReport =
    Read.reclaimReport(ggCall("context.evict_file_view", ggText(path)))

/**
 * Move whole turns out of the context window and report what that reclaimed.
 *
 * Every result carries a header with its turn number and roughly what holding it costs.
 * `gg.context.archiveThread(4..19)` archives turns 4 through 19, and `4..<20` means the same span.
 * This session's own messages in an archived turn are dropped; the results are kept and stay
 * searchable.
 *
 * @ggop context.archive_thread
 * @param ranges The spans of turn numbers to move out of the window.
 * @return what the archive reclaimed
 * @throws ApiError `INVALID_ARGUMENT` for a span whose ends are not turn numbers.
 */
public fun archiveThread(vararg ranges: IntRange): ReclaimReport {
    val spans = arrayOfNulls<Value>(ranges.size)
    for (index in ranges.indices) {
        spans[index] =
            ggRecord()
                .put("start", ggNumber(ranges[index].first))
                .put("end", ggNumber(ranges[index].last))
    }
    @Suppress("UNCHECKED_CAST")
    return Read.reclaimReport(
        ggCall("context.archive_thread", ggList(*(spans as Array<Value>))),
    )
}

/**
 * Search archived history for a case-insensitive substring, most recent first, up to 8 hits.
 *
 * [ArchiveSearch.archiveEmpty] distinguishes nothing having been archived yet from a search that ran
 * and matched nothing.
 *
 * @ggop context.search_archive
 * @param query The substring to look for. Matching is case-insensitive.
 * @return what the search found, and whether there was anything to search
 * @throws ApiError `INVALID_ARGUMENT` for an empty query.
 */
public fun searchArchive(query: String): ArchiveSearch =
    Read.archiveSearch(ggCall("context.search_archive", ggText(query)))

/**
 * Compact the context window: the detailed thread is dropped and restarted from a summary.
 *
 * The skills, memories and task list are kept as they are. gg asks for this call when the window is
 * full, and every other call is refused until it is made.
 *
 * It does not stop the program: it registers the request and returns, and the rewrite happens once
 * the program has ended. Everything not in the summary and not named in `files` is gone.
 *
 * @ggop context.compact
 * @param summary What the restarted window opens with.
 * @param files The paths to read afresh into the restarted window. Naming none reads nothing back.
 * @throws ApiError `INVALID_ARGUMENT` for a blank summary. This is the one call gg does not refuse
 *   while a compaction is in flight, since nothing else can clear the window.
 */
public fun compact(summary: String, vararg files: String) {
    ggRun("context.compact", ggText(summary), ggTexts(files.asIterable()))
}

/**
 * What a context reclaim actually freed from the live context window.
 *
 * @property items Context items dropped from the live window.
 * @property reclaimedTokens Approximately how many tokens that freed.
 * @property paths The workspace paths whose views were evicted. Empty for an archive.
 * @property detail The prose summary of what was reclaimed.
 */
public data class ReclaimReport(
    val items: Int,
    val reclaimedTokens: Int,
    val paths: List<String>,
    val detail: String,
)

/**
 * What an archive search found.
 *
 * @property archiveEmpty Whether nothing has been archived yet, so there was nothing to search.
 * @property hits The matches, most recent first, at most 8.
 */
public data class ArchiveSearch(val archiveEmpty: Boolean, val hits: List<ArchiveHit>)

/**
 * One archived message that matched a search.
 *
 * @property seq The archived message's sequence number.
 * @property role Who said it.
 * @property text The message text.
 */
public data class ArchiveHit(val seq: Int, val role: MessageRole, val text: String)

/** Who said an archived message. */
public enum class MessageRole {
    /** The system prompt. */
    SYSTEM,

    /** A turn's input: a result, a view, or an operator's instruction. */
    USER,

    /** Something this session said. */
    ASSISTANT,

    /** A tool result, on a session that made tool calls rather than writing programs. */
    TOOL,
}

