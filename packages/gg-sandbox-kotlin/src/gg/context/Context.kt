/**
 * Managing the agent's own context window.
 *
 * These are the only calls whose effect is on the conversation rather than on the workspace, and they
 * are worth making from a program precisely because a program can decide when to: read a set of
 * files, extract what matters, then evict the views in the same turn.
 *
 * @ggmodule context
 */
package gg.context

import gg.core.ToolError
import gg.internal.Read
import gg.internal.contextObject
import gg.internal.ggArgs
import gg.internal.ggCall
import gg.internal.ggNumber
import gg.internal.ggRecord
import gg.internal.ggRun
import gg.internal.ggSet
import gg.internal.ggText
import gg.internal.ggTexts
import org.teavm.jso.JSObject
import org.teavm.jso.core.JSArray


/**
 * Drop the contents of files that were read out of the context window, and report what that
 * reclaimed.
 *
 * The files on disk are untouched: this forgets what was read, not what exists.
 *
 * @ggop context.evict_file_view
 * @param path The file whose views to drop. Left out, every file that was read is dropped.
 * @return what the eviction reclaimed
 * @throws ToolError `NOT_FOUND` when the named path has no view open.
 */
public fun evictFileView(path: String? = null): ReclaimReport =
    Read.reclaimReport(
        ggCall(
            "evict_file_view",
            contextObject(),
            "gg.context",
            "evictFileView",
            if (path == null) ggArgs() else ggArgs(ggText(path)),
        ),
    )

/**
 * Move whole turns out of the context window and report what that reclaimed.
 *
 * Every result carries a header with its turn number and roughly what holding it costs, so the turns
 * worth dropping are named as ranges — which is what a span of integers is in this language.
 * `gg.context.archiveThread(4..19)` archives turns 4 through 19, and `4..<20` means the same span.
 * The agent's own messages in an archived turn are dropped; the results are kept and stay searchable.
 *
 * @ggop context.archive_thread
 * @param ranges The spans of turn numbers to move out of the window.
 * @return what the archive reclaimed
 * @throws ToolError `INVALID_ARGUMENT` for a span whose ends are not turn numbers.
 */
public fun archiveThread(vararg ranges: IntRange): ReclaimReport {
    val lowered = JSArray<JSObject>()
    for (range in ranges) {
        val span = ggRecord()
        ggSet(span, "from", ggNumber(range.first))
        ggSet(span, "to", ggNumber(range.last))
        lowered.push(span)
    }
    return Read.reclaimReport(
        ggCall("archive_thread", contextObject(), "gg.context", "archiveThread", ggArgs(lowered)),
    )
}

/**
 * Search archived history for a case-insensitive substring, most recent first, up to 8 hits.
 *
 * [ArchiveSearch.archiveEmpty] is worth reading before the hits: it distinguishes "nothing has been
 * archived yet" from "the search ran and matched nothing", so a program does not archive again
 * believing the first archive failed.
 *
 * @ggop context.search_archive
 * @param query The substring to look for. Matching is case-insensitive.
 * @return what the search found, and whether there was anything to search
 * @throws ToolError `INVALID_ARGUMENT` for an empty query.
 */
public fun searchArchive(query: String): ArchiveSearch =
    Read.archiveSearch(
        ggCall("search_archive", contextObject(), "gg.context", "searchArchive", ggArgs(ggText(query))),
    )

/**
 * Compact the context window: the detailed thread is dropped and restarted from a summary.
 *
 * The skills, memories and task list are kept as they are. gg asks for this call when the window is
 * full, and every other call is refused until it is made.
 *
 * It does not stop the program: it registers the request and returns, and the rewrite happens once
 * the program has ended. Everything not in the summary and not named in `files` is gone, so the
 * summary is written for the agent that resumes and the file list is what it will need in hand.
 *
 * @ggop context.compact
 * @param summary What the restarted window opens with, written for the agent that resumes.
 * @param files The paths to read afresh into the restarted window. Naming none reads nothing back.
 * @throws ToolError `REFUSED` when a compaction is already in flight and this call is not the one it
 *   asked for.
 */
public fun compact(summary: String, vararg files: String) {
    ggRun(
        "compact",
        contextObject(),
        "gg.context",
        "compact",
        ggArgs(ggText(summary), ggTexts(files.asIterable())),
    )
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

    /** A turn's input to the agent: a result, a view, or an operator's instruction. */
    USER,

    /** Something the agent said. */
    ASSISTANT,

    /** A tool result, on a session that made tool calls rather than writing programs. */
    TOOL,
}

