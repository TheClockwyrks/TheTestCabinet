package gg.context;

import gg.ToolError;
import gg.ToolErrorCode;
import gg.internal.Read;
import gg.internal.Wire;
import java.util.List;
import org.teavm.jso.JSObject;
import org.teavm.jso.core.JSArray;

/**
 * Reclaim room in the agent's own context window.
 *
 * <p>Four calls, in the order a full window wants them: drop file views that are done with, move
 * whole turns into the archive, search the archive for what was moved, and — when none of that is
 * enough — compact.
 *
 * <p>These are the only calls whose effect is on the conversation rather than on the workspace, and
 * they are worth making from a program precisely because a program can decide when: read a set of
 * files, extract what matters, and evict the views in the same turn.
 *
 * @ggmodule context
 */
public final class Context {
    private Context() {
    }

    /**
     * Drop what one file, or every file, put in the context window, and report what that freed.
     *
     * <p>Called with nothing it drops every file read into the window. The files on disk are
     * untouched either way: this forgets what was read rather than what exists.
     *
     * @return what the eviction reclaimed
     * @ggop context.evict_file_view
     */
    public static ReclaimReport evictFileView() {
        return Read.reclaimReport(Wire.call("evict_file_view", Wire.context(), "context",
                "evictFileView", Wire.args()));
    }

    /**
     * Drop the contents of one file read into the context window.
     *
     * @param path The file whose views to drop.
     * @return what the eviction reclaimed
     * @ggop context.evict_file_view
     */
    public static ReclaimReport evictFileView(String path) {
        return Read.reclaimReport(Wire.call("evict_file_view", Wire.context(), "context",
                "evictFileView", Wire.args(Wire.text(path))));
    }

    /**
     * Move whole turns out of the context window, and report what that freed.
     *
     * <p>Every result carries a header with its turn number and roughly what holding it costs, which
     * is what the spans are named from: a span is inclusive at both ends, so
     * {@code new Context.TurnRange(4, 19)} archives turns 4 through 19. An archived turn's own
     * messages are dropped; its results are kept and stay searchable with {@link #searchArchive}.
     *
     * @param ranges The inclusive spans of turn numbers to move out of the window.
     * @return what the archive reclaimed
     * @throws ToolError {@link ToolErrorCode#INVALID_ARGUMENT} for a span whose ends are not turn
     *     numbers.
     * @ggop context.archive_thread
     */
    public static ReclaimReport archiveThread(TurnRange... ranges) {
        JSArray<JSObject> lowered = new JSArray<>();
        for (TurnRange range : ranges) {
            JSObject span = Wire.object();
            Wire.set(span, "from", Wire.number(range.from()));
            Wire.set(span, "to", Wire.number(range.to()));
            lowered.push(span);
        }
        return Read.reclaimReport(Wire.call("archive_thread", Wire.context(), "context",
                "archiveThread", Wire.args(lowered)));
    }

    /**
     * Search archived history for a case-insensitive substring, most recent first, up to eight hits.
     *
     * <p>{@code archiveEmpty} is worth reading before {@code hits}: it tells "nothing has been
     * archived yet" apart from "the search ran and matched nothing", so a program does not archive
     * again believing the first archive failed.
     *
     * @param query The substring to look for. Matching is case-insensitive.
     * @return what the search found, and whether there was anything to search
     * @ggop context.search_archive
     */
    public static ArchiveSearch searchArchive(String query) {
        return Read.archiveSearch(Wire.call("search_archive", Wire.context(), "context",
                "searchArchive", Wire.args(Wire.text(query))));
    }

    /**
     * Compact the context window: the detailed thread is dropped and restarted from a summary.
     *
     * <p>Skills, memories and the task list are kept as they are, and each named file is read
     * afresh. gg asks for this call when the window is full, and refuses every other call until it
     * arrives.
     *
     * <p>It does not stop the program: it registers the request and returns, and the rewrite happens
     * once the program has ended. Everything not in the summary and not re-read is gone, so the
     * summary is written for the agent that wakes up next.
     *
     * @param summary What the restarted window opens with. Everything not in it and not re-read from
     *     {@code files} is gone.
     * @param files The paths to read afresh into the restarted window. Naming none reads nothing
     *     back.
     * @throws ToolError {@link ToolErrorCode#REFUSED} when a compaction is already in flight and
     *     this call is not the one it asked for.
     * @ggop context.compact
     */
    public static void compact(String summary, String... files) {
        Wire.run("compact", Wire.context(), "context", "compact",
                Wire.args(Wire.text(summary), Wire.texts(files)));
    }

    // -------------------------------------------------------------------------------------------
    // The types a reclaim hands back
    // -------------------------------------------------------------------------------------------

    /**
     * An inclusive span of turn numbers, which is the unit an archive moves.
     *
     * <p>The numbers are the ones on the header of every result, so {@code new TurnRange(4, 19)}
     * means exactly the turns numbered 4 through 19, both ends included.
     *
     * @param from The first turn in the span.
     * @param to The last turn in the span, inclusive.
     */
    public record TurnRange(int from, int to) {
    }

    /**
     * What a reclaim actually freed from the live context window.
     *
     * @param items How many context items were dropped from the live window.
     * @param reclaimedTokens Approximately how many tokens that freed.
     * @param paths The workspace paths whose views were evicted. Empty for an archive.
     * @param detail The prose summary of what was reclaimed.
     */
    public record ReclaimReport(int items, int reclaimedTokens, List<String> paths, String detail) {
    }

    /**
     * What a search of the archive found.
     *
     * @param archiveEmpty Whether nothing has been archived yet, so there was nothing to search.
     * @param hits The matches, most recent first, at most eight.
     */
    public record ArchiveSearch(boolean archiveEmpty, List<ArchiveHit> hits) {
    }

    /**
     * One archived message that matched a search.
     *
     * @param seq The archived message's sequence number.
     * @param role Who said it.
     * @param text The message text.
     */
    public record ArchiveHit(int seq, MessageRole role, String text) {
    }

    /** Who said an archived message. */
    public enum MessageRole {
        /** The system prompt. */
        SYSTEM,
        /** A turn's input to the agent — a result, a view, or an operator's instruction. */
        USER,
        /** Something the agent said. */
        ASSISTANT,
        /** A tool result, on a session that made tool calls rather than writing programs. */
        TOOL
    }
}
