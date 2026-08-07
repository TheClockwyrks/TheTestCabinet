package gg;

import gg.internal.Read;
import gg.internal.Wire;
import org.teavm.jso.JSObject;
import org.teavm.jso.core.JSArray;

/**
 * The {@code context} object: managing your own context window.
 *
 * <p>These are the only calls whose effect is on the conversation rather than on the workspace.
 * They are worth making from a program precisely because a program can decide <em>when</em> to:
 * read a set of files, extract what matters, then evict the views in the same turn.
 */
public final class Context extends ApiObject {
    Context() {
        super("context");
    }

    @Override
    JSObject target() {
        return Wire.context();
    }

    /**
     * Drop the contents of every file you have read out of your context window, freeing the tokens
     * they occupy, and report what that reclaimed.
     *
     * <p>The files on disk are untouched — this forgets what you read, not what exists.
     *
     * @return what the eviction reclaimed
     */
    public ReclaimReport evictFileView() {
        return Read.reclaimReport(Wire.call("evict_file_view", target(), object(),
                "evictFileView", Wire.args()));
    }

    /**
     * Drop the contents of one file you have read out of your context window.
     *
     * @param path The file whose views to drop.
     * @return what the eviction reclaimed
     */
    public ReclaimReport evictFileView(String path) {
        return Read.reclaimReport(Wire.call("evict_file_view", target(), object(),
                "evictFileView", Wire.args(Wire.text(path))));
    }

    /**
     * Move whole turns out of your context window and report what that reclaimed.
     *
     * <p>Every result you are given carries a header with its turn number and roughly what holding
     * it costs, so name the turns worth dropping: a span is inclusive at both ends, and
     * {@code context.archiveThread(new TurnRange(4, 19))} archives turns 4 through 19. Your own
     * messages in an archived turn are dropped; the results are kept and stay searchable with
     * {@code context.searchArchive}.
     *
     * @param ranges The inclusive spans of turn numbers to move out of your window.
     * @return what the archive reclaimed
     * @throws ToolError {@code INVALID_ARGUMENT} for a span whose ends are not turn numbers.
     */
    public ReclaimReport archiveThread(TurnRange... ranges) {
        JSArray<JSObject> lowered = new JSArray<>();
        for (TurnRange range : ranges) {
            JSObject span = Wire.object();
            Wire.set(span, "from", Wire.number(range.from()));
            Wire.set(span, "to", Wire.number(range.to()));
            lowered.push(span);
        }
        return Read.reclaimReport(Wire.call("archive_thread", target(), object(), "archiveThread",
                Wire.args(lowered)));
    }

    /**
     * Search archived history for a case-insensitive substring, most recent first, up to 8 hits.
     *
     * <p>Check {@code archiveEmpty} before reading {@code hits}: it distinguishes "nothing has
     * been archived yet" from "the search ran and matched nothing", so you do not archive again
     * believing the first archive failed.
     *
     * @param query The substring to look for. Matching is case-insensitive.
     * @return what the search found, and whether there was anything to search
     */
    public ArchiveSearch searchArchive(String query) {
        return Read.archiveSearch(Wire.call("search_archive", target(), object(), "searchArchive",
                Wire.args(Wire.text(query))));
    }

    /**
     * Compact your context window: the detailed thread is dropped and restarted from
     * {@code summary}, plus a fresh read of each path in {@code files}.
     *
     * <p>Your skills, memories and task list are kept as they are. You are asked to call this when
     * your window is full, and every other call is refused until you do.
     *
     * <p>It does NOT stop your program: it registers the request and returns, and the rewrite
     * happens once your program has ended. Everything not in your summary and not in
     * {@code files} is gone, so write the summary for your future self and name the files you will
     * actually need in hand.
     *
     * @param summary What your restarted window opens with. Write it for your future self:
     *     everything not in it and not re-read from {@code files} is gone.
     * @param files The paths to read afresh into the restarted window. Name none to read nothing
     *     back.
     * @throws ToolError {@code REFUSED} when a compaction is already in flight and this call is
     *     not the one it asked for.
     */
    public void compact(String summary, String... files) {
        Wire.run("compact", target(), object(), "compact",
                Wire.args(Wire.text(summary), Wire.texts(files)));
    }
}
