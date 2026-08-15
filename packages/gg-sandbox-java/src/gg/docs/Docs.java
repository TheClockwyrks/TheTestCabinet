package gg.docs;

import gg.ToolError;
import gg.ToolErrorCode;
import gg.internal.Read;
import gg.internal.Wire;
import java.util.List;
import org.teavm.jso.JSObject;

/**
 * Search this surface, and take a documentation view back out of the window.
 *
 * <p>This is where a session starts. Nothing names the functions of this surface up front, so
 * {@link #search} is what turns "what do I have" into a list of one-line briefs and the
 * fully-qualified names {@code gg.views.Views.openDocsView} takes to read one of them in full.
 *
 * <p>A search only ever returns what this agent may actually call. The compiler is less careful —
 * the SDK is one jar and every class on it compiles — so a program can write a call a search would
 * never have shown it, and what happens then is a {@link ToolErrorCode#UNAVAILABLE} naming the
 * capability this run withheld.
 *
 * @ggmodule docs
 */
public final class Docs {
    private Docs() {
    }

    /**
     * Find what this agent can call, by keyword or by module, and read the briefs that come back.
     *
     * <p>Matching is case-insensitive substring matching over names, signatures, briefs and detailed
     * descriptions, so {@code "docs"} finds {@code openDocsView}. A hit whose own name matched
     * ranks above one that merely mentions the word in a paragraph, and the query is split on
     * whitespace, so several specific words work better than a sentence.
     *
     * <p>The page comes back as a value <em>and</em> opens as a view, so the results can be read on
     * the next turn without being shown deliberately. The next search replaces that view: it names
     * what is being worked from rather than keeping a record.
     *
     * @param query The words to look for, as one string. Several specific words beat a sentence.
     * @return one page of matches, best first, and the total behind it
     * @throws ToolError {@link ToolErrorCode#INVALID_ARGUMENT} for a blank query, which is a
     *     question with no filter and no words in it. {@link #search(String, SearchFilters)} is the
     *     overload that takes one instead.
     * @ggop docs.search
     */
    public static DocSearch search(String query) {
        return Read.docSearch(Wire.call("search", Wire.docs(), "docs", "search",
                Wire.args(Wire.text(query))));
    }

    /**
     * The same search, narrowed by module, by type or by kind, and paged.
     *
     * <p>The filters compose with the query and with each other, and each is an exact lookup rather
     * than another thing to rank: an empty query carrying only
     * {@link SearchFilters#module(String)} is that module's whole directory, which is the first hop
     * worth making. Being a lookup, a module or type name gg does not hold matches nothing rather
     * than failing — an empty page there means the filter found nothing, not that it was rejected.
     *
     * @param query The words to look for. It may be empty here, where a filter says what to look at
     *     instead.
     * @param filters What to narrow to, and which page to read. It may carry nothing, which is the
     *     same request the one-argument overload makes.
     * @return one page of matches, best first, and the total behind it
     * @throws ToolError {@link ToolErrorCode#INVALID_ARGUMENT} for a blank query with no filter
     *     beside it — a search that asked for nothing and a search that found nothing are different
     *     answers — and for a {@link SearchFilters#limit(int)} of zero, which is a page that could
     *     answer nothing.
     * @ggop docs.search
     */
    public static DocSearch search(String query, SearchFilters filters) {
        return Read.docSearch(Wire.call("search", Wire.docs(), "docs", "search",
                Wire.args(Wire.text(query), filters.lowered())));
    }

    /**
     * Take one documentation view back out of the context window, by the key it was opened under.
     *
     * <p>A plain removal with no cascade: closing a function's view leaves the views of the types it
     * named exactly where they were, and closing a type's leaves the functions. A key that is not
     * open closes zero rather than failing, so a program that tidies up unconditionally needs no
     * guard, and a type closed here is opened again by the next function that mentions it.
     *
     * @param key The fully-qualified name the view was opened under, as {@link DocHit#key()}
     *     reports it.
     * @return how many views were closed, which is one unless it had already gone
     * @throws ToolError {@link ToolErrorCode#UNAVAILABLE} for an agent this run did not give the
     *     closing of documentation views. Opening one only ever appends to the end of the prompt,
     *     while closing one rewrites its middle, which is why opening is always available and
     *     closing is bought.
     * @ggop docs.close
     */
    public static int close(String key) {
        return Wire.asInteger(Wire.call("close", Wire.docs(), "docs", "close",
                Wire.args(Wire.text(key))));
    }

    /**
     * Take every documentation view out of the context window at once.
     *
     * <p>The blanket form of {@link #close}, on the same terms and behind the same capability: no
     * cascade to worry about because nothing is left, and zero rather than a failure when none was
     * open. It is the call for reclaiming the window between one piece of work and the next, where
     * naming each key would be a list to keep.
     *
     * @return how many views went
     * @throws ToolError {@link ToolErrorCode#UNAVAILABLE} for an agent this run did not give the
     *     closing of documentation views.
     * @ggop docs.close_all
     */
    public static int closeAll() {
        return Wire.asInteger(Wire.call("close_all", Wire.docs(), "docs", "closeAll",
                Wire.args()));
    }

    // -------------------------------------------------------------------------------------------
    // What a search takes and hands back
    // -------------------------------------------------------------------------------------------

    /**
     * What a search is narrowed to, and which page of it to read, built a call at a time.
     *
     * <p>Java has no keyword arguments and five optional filters would be an overload per subset, so
     * they are named the way this SDK names every other optional group — one method each, chained.
     * A filter never named narrows nothing.
     *
     * <pre>{@code
     * Docs.DocSearch found = Docs.search("", new Docs.SearchFilters().module("memories"));
     * }</pre>
     */
    public static final class SearchFilters {
        private final JSObject filters = Wire.object();

        /** A search narrowed to nothing yet. */
        public SearchFilters() {
        }

        /**
         * Narrow to one module, which with an empty query is that module's whole directory.
         *
         * <p>The module is named either the way a program writes it ({@code gg.files.Files}) or by
         * gg's own id ({@code files}), exactly and case-insensitively. It is a lookup rather than a
         * search, so a name no module has matches nothing rather than failing.
         *
         * @param module The module to narrow to.
         * @return these filters, so calls chain
         */
        public SearchFilters module(String module) {
            Wire.set(filters, "module", Wire.text(module));
            return this;
        }

        /**
         * Narrow to one type by its own name ({@code FileRead}, not the key a hit reports), and to functions mentioning it.
         *
         * @param type The type's own name.
         * @return these filters, so calls chain
         */
        public SearchFilters type(String type) {
            Wire.set(filters, "type", Wire.text(type));
            return this;
        }

        /**
         * Narrow to modules, to functions or to types. Never named, all three are searched.
         *
         * @param kind Which of the three to see.
         * @return these filters, so calls chain
         */
        public SearchFilters kind(DocKind kind) {
            Wire.set(filters, "kind", Wire.text(kind.wireName()));
            return this;
        }

        /**
         * Skip hits, for reading past the first page.
         *
         * @param offset How many hits to skip. Never named, the page starts at the first.
         * @return these filters, so calls chain
         */
        public SearchFilters offset(int offset) {
            Wire.set(filters, "offset", Wire.number(offset));
            return this;
        }

        /**
         * Cap the page: 20 hits by default, 100 at most, and zero refused.
         *
         * @param limit How many hits to return: 20 by default, 100 at most, and zero is refused.
         *     Compare it against {@link DocSearch#total()} to see how much of the answer this page is.
         * @return these filters, so calls chain
         */
        public SearchFilters limit(int limit) {
            Wire.set(filters, "limit", Wire.number(limit));
            return this;
        }

        /** What was set, on its way out. */
        JSObject lowered() {
            return filters;
        }
    }

    /**
     * Which of the three things a documentation entry describes.
     *
     * <p>A surface is the modules a program imports, the functions inside them, and the types their
     * signatures name. A parameter is not one of the three: it is documented on the function that
     * takes it.
     */
    public enum DocKind {
        /** A module a program imports, and whose functions live inside it. */
        MODULE("module"),
        /** A function a program calls. */
        FUNCTION("function"),
        /** A type a signature names. */
        TYPE("type");

        private final String wire;

        DocKind(String wire) {
            this.wire = wire;
        }

        /**
         * gg's own word for this kind, which is what the filter is sent as.
         *
         * @return the name gg uses on the wire
         */
        public String wireName() {
            return wire;
        }
    }

    /**
     * One entry a search matched: enough to choose from, and no more.
     *
     * @param key The fully-qualified name it is documented under, and what
     *     {@code gg.views.Views.openDocsView} takes to read the whole of it.
     * @param kind Whether this entry is a module, a function or a type.
     * @param module The module it lives in; for a type, every module mentioning it,
     *     comma-separated — so not one to hand back as a filter.
     * @param name The name a program calls it by, or the type's own name.
     * @param summary Its brief, and only its brief. Everything else written about it is what a
     *     documentation view holds.
     */
    public record DocHit(String key, DocKind kind, String module, String name, String summary) {
    }

    /**
     * One page of search results, and the total behind it.
     *
     * @param total How many entries matched before paging, so a capped page is not read as a whole
     *     answer.
     * @param offset The offset this page starts at, echoed back, so paging needs nothing tracked on
     *     the side.
     * @param hits The page itself, best first.
     */
    public record DocSearch(int total, int offset, List<DocHit> hits) {
    }
}
