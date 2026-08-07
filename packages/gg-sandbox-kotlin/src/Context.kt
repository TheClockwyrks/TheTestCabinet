import org.teavm.jso.JSObject
import org.teavm.jso.core.JSArray

/**
 * The `context` object: managing your own context window.
 *
 * These are the only calls whose effect is on the conversation rather than on the workspace. They are
 * worth making from a program precisely because a program can decide *when* to: read a set of files,
 * extract what matters, then evict the views in the same turn.
 */
public class Context internal constructor() : ApiObject("context") {
    override fun target(): JSObject? = contextObject()

    /**
     * Drop the contents of files you have read out of your context window, freeing the tokens they
     * occupy, and report what that reclaimed.
     *
     * The files on disk are untouched — this forgets what you read, not what exists.
     *
     * @param path The file whose views to drop. Leave it out to drop every file you have read.
     * @return what the eviction reclaimed
     */
    public fun evictFileView(path: String? = null): ReclaimReport =
        Read.reclaimReport(
            ggCall(
                "evict_file_view",
                target(),
                owner,
                "evictFileView",
                if (path == null) ggArgs() else ggArgs(ggText(path)),
            ),
        )

    /**
     * Move whole turns out of your context window and report what that reclaimed.
     *
     * Every result you are given carries a header with its turn number and roughly what holding it costs,
     * so name the turns worth dropping — as **ranges**, which is what a span of integers is in this
     * language: `context.archiveThread(4..19)` archives turns 4 through 19, and `4..<20` means the same
     * span. Your own messages in an archived turn are dropped; the results are kept and stay searchable
     * with `context.searchArchive`.
     *
     * @param ranges The spans of turn numbers to move out of your window.
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
            ggCall("archive_thread", target(), owner, "archiveThread", ggArgs(lowered)),
        )
    }

    /**
     * Search archived history for a case-insensitive substring, most recent first, up to 8 hits.
     *
     * Check `archiveEmpty` before reading `hits`: it distinguishes "nothing has been archived yet" from
     * "the search ran and matched nothing", so you do not archive again believing the first archive
     * failed.
     *
     * @param query The substring to look for. Matching is case-insensitive.
     * @return what the search found, and whether there was anything to search
     */
    public fun searchArchive(query: String): ArchiveSearch =
        Read.archiveSearch(
            ggCall("search_archive", target(), owner, "searchArchive", ggArgs(ggText(query))),
        )

    /**
     * Compact your context window: the detailed thread is dropped and restarted from `summary`, plus a
     * fresh read of each path in `files`.
     *
     * Your skills, memories and task list are kept as they are. You are asked to call this when your
     * window is full, and every other call is refused until you do.
     *
     * It does NOT stop your program: it registers the request and returns, and the rewrite happens once
     * your program has ended. Everything not in your summary and not in `files` is gone, so write the
     * summary for your future self and name the files you will actually need in hand.
     *
     * @param summary What your restarted window opens with. Write it for your future self: everything not
     *   in it and not re-read from `files` is gone.
     * @param files The paths to read afresh into the restarted window. Name none to read nothing back.
     * @throws ToolError `REFUSED` when a compaction is already in flight and this call is not the one it
     *   asked for.
     */
    public fun compact(summary: String, vararg files: String) {
        ggRun(
            "compact",
            target(),
            owner,
            "compact",
            ggArgs(ggText(summary), ggTexts(files.asIterable())),
        )
    }
}
