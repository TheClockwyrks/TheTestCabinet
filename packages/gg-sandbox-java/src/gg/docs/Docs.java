package gg.docs;

import gg.ApiError;
import gg.ApiErrorCode;
import gg.internal.Coding;
import gg.internal.Read;
import gg.internal.Value;
import java.util.List;

/**
 * Search this surface, and take a documentation view back out of the window.
 *
 * <p>A search returns one-line briefs and the fully-qualified name each entry is documented under,
 * and only entries this run may call.
 *
 * <p>The SDK is one jar and every class on it compiles, so a call this run does not offer still
 * compiles and fails with {@link ApiErrorCode#UNAVAILABLE} naming the capability withheld.
 *
 * @ggmodule docs
 */
public final class Docs {
    private Docs() {
    }

    /**
     * Find what this run can call, by words or by module, and read the briefs that come back.
     *
     * <p>Matching is case-insensitive substring matching over names, signatures, briefs and detailed
     * descriptions, so {@code "docs"} finds {@code openDocsView}. A hit whose own name matched
     * ranks above one that merely mentions the word, and the query is split on whitespace.
     *
     * <p>The words rank; the filters are exact lookups that compose with the words and with each
     * other. {@link SearchFilters#modules(String...)} with no query beside it is those modules'
     * whole directory. A module or type name gg does not hold matches nothing rather than failing.
     *
     * <p>The page comes back as a value and opens as a view, which the next search replaces.
     *
     * @param filters What to look for, what to narrow to, and which page to read. It has to carry
     *     one of the two ways of asking — words, or a filter — and may carry both.
     * @return one page of matches, best first, and the total behind it
     * @throws ApiError {@link ApiErrorCode#INVALID_ARGUMENT} for filters carrying no words and no
     *     filter, and for a {@link SearchFilters#limit(int)} of zero.
     * @ggop docs.search
     */
    public static DocSearch search(SearchFilters filters) {
        return Read.docSearch(Coding.call("docs.search", filters.query, filters.modules,
                filters.type, filters.kind, filters.offset, filters.limit));
    }

    /**
     * Take one documentation view back out of the context window, by the key it was opened under.
     *
     * <p>A plain removal with no cascade: closing a function's view leaves the views of the types it
     * named where they were, and closing a type's leaves the functions. A key that is not open
     * closes zero rather than failing, and a type closed here is opened again by the next function
     * that mentions it.
     *
     * @param key The fully-qualified name the view was opened under, as {@link DocHit#key()}
     *     reports it.
     * @return how many views were closed, which is one unless it had already gone
     * @throws ApiError {@link ApiErrorCode#UNAVAILABLE} where this run did not enable the closing
     *     of documentation views.
     * @ggop docs.close
     */
    public static int close(String key) {
        return Coding.call("docs.close", Value.of(key)).integer();
    }

    /**
     * Take every documentation view out of the context window at once.
     *
     * <p>Closes zero rather than failing when none was open.
     *
     * @return how many views went
     * @throws ApiError {@link ApiErrorCode#UNAVAILABLE} where this run did not enable the closing
     *     of documentation views.
     * @ggop docs.close_all
     */
    public static int closeAll() {
        return Coding.call("docs.close_all").integer();
    }

    // -------------------------------------------------------------------------------------------
    // What a search takes and hands back
    // -------------------------------------------------------------------------------------------

    /**
     * What a search asks, what it is narrowed to, and which page to read, built a call at a time.
     *
     * <p>A part never named asks for nothing and narrows nothing. Filters naming none of the six
     * are refused.
     *
     * <pre>{@code
     * Docs.DocSearch found = Docs.search(new Docs.SearchFilters().modules("memories"));
     * }</pre>
     */
    public static final class SearchFilters {
        /** The words to look for, absent until some are named. */
        Value query = Value.none();

        /** The modules to narrow to; empty until some are named. */
        Value modules = Value.list();

        /** The type to narrow to, absent until one is named. */
        Value type = Value.none();

        /** The kind to narrow to, absent until one is named. */
        Value kind = Value.none();

        /** How many hits to skip, absent until one is named. */
        Value offset = Value.none();

        /** How many hits to return, absent until one is named. */
        Value limit = Value.none();

        /** A search asking for nothing and narrowed to nothing yet. */
        public SearchFilters() {
        }

        /**
         * Look for words, which rank the hits rather than narrowing them.
         *
         * @param query The words to look for, as one string. Several specific words beat a sentence.
         * @return these filters, so calls chain
         */
        public SearchFilters query(String query) {
            this.query = Value.of(query);
            return this;
        }

        /**
         * Narrow to some modules, which with no query beside them is their whole directory.
         *
         * <p>Several modules are a union rather than a narrowing of each other: an entry any one of
         * them publishes is a hit, so the surface an agent holds is one call rather than one per
         * module. A module is named either the way a program writes it ({@code gg.files.Files}) or
         * by gg's own id ({@code files}), exactly and case-insensitively — which is how
         * {@link DocHit#module()} reports it, so a hit says what to narrow the next search to. It
         * is a lookup rather than a search, so a name no module has matches nothing rather than
         * failing.
         *
         * @param modules The modules to narrow to. Naming none is no module filter at all, which is
         *     what a search that never called this asks for.
         * @return these filters, so calls chain
         */
        public SearchFilters modules(String... modules) {
            this.modules = Value.texts(modules);
            return this;
        }

        /**
         * Narrow to one type by its own name ({@code FileRead}, not the key a hit reports), and to functions mentioning it.
         *
         * @param type The type's own name.
         * @return these filters, so calls chain
         */
        public SearchFilters type(String type) {
            this.type = Value.of(type);
            return this;
        }

        /**
         * Narrow to modules, to functions or to types. Never named, all three are searched.
         *
         * @param kind Which of the three to see.
         * @return these filters, so calls chain
         */
        public SearchFilters kind(DocKind kind) {
            this.kind = Value.of(kind.wireName());
            return this;
        }

        /**
         * Skip hits, for reading past the first page.
         *
         * @param offset How many hits to skip. Never named, the page starts at the first.
         * @return these filters, so calls chain
         */
        public SearchFilters offset(int offset) {
            this.offset = Value.of(offset);
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
            this.limit = Value.of(limit);
            return this;
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
     * @param key The fully-qualified name it is documented under.
     * @param kind Whether this entry is a module, a function or a type.
     * @param module The one module it belongs to: the module a function is published by, or the
     *     module a type is declared in.
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
