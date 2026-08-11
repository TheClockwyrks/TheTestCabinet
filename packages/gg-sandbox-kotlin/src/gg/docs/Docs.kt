/**
 * Search this surface for a function, and take a documentation view back out of the window.
 *
 * This is where a session starts. Nothing names the functions of this surface up front, so [search]
 * is what turns "what do I have" into a list of one-line briefs and the fully-qualified names
 * `gg.views.openDocsView` takes to read one of them in full.
 *
 * A search only ever returns what this agent may actually call. The compiler is less careful — the
 * SDK is one jar and every package on it compiles — so a program can write a call a search would
 * never have shown it, and what happens then is an `UNAVAILABLE` failure naming the capability this
 * run withheld.
 *
 * @ggmodule docs
 */
package gg.docs

import gg.core.ToolError
import gg.internal.Read
import gg.internal.docsObject
import gg.internal.ggArgs
import gg.internal.ggAsInteger
import gg.internal.ggCall
import gg.internal.ggNumber
import gg.internal.ggRecord
import gg.internal.ggSet
import gg.internal.ggText

/**
 * Find what this agent can call, by keyword or by module, and read the briefs that come back.
 *
 * Matching is case-insensitive substring matching over names, signatures, briefs and detailed
 * descriptions, so `"docs"` finds `openDocsView`. A hit whose own name matched ranks above one
 * that merely mentions the word in a paragraph, and the query is split on whitespace, so several
 * specific words work better than a sentence.
 *
 * The filters compose with the query and with each other, and each is an exact lookup rather than
 * another thing to rank: an empty query carrying only [module] is that module's whole directory,
 * which is the first hop worth making.
 *
 * The page comes back as a value *and* opens as a view, so the results can be read on the next turn
 * without being shown deliberately. The next search replaces that view: it names what is being
 * worked from rather than keeping a record.
 *
 * @ggop docs.search
 * @param query The words to look for, as one string. Several specific words beat a sentence; it may
 *   be empty only when a filter says what to look at instead.
 * @param module One module, named either the way a program writes it (`gg.files`) or by gg's own id
 *   (`files`). Exact and case-insensitive: a module filter is a lookup, so a name no module has
 *   matches nothing rather than failing.
 * @param type One type's own name — `"FileRead"`, not the key it is documented under — narrowing
 *   to that type and to the functions whose signatures mention it. Like [module] a lookup, so a name
 *   nothing declares matches nothing rather than failing.
 * @param kind Narrow to functions or to types. Left out, both are searched.
 * @param offset How many hits to skip, for reading past the first page. Left out, the page starts at
 *   the first hit.
 * @param limit How many hits to return: 20 by default, 100 at most, and zero is refused. Compare it
 *   against [DocSearch.total] to see how much of the answer this page is.
 * @return one page of matches, best first, and the total behind it
 * @throws ToolError `INVALID_ARGUMENT` for a blank query with no filter beside it — a search that
 *   asked for nothing and a search that found nothing are different answers — and for a [limit] of
 *   zero, which is a page that could answer nothing.
 */
public fun search(
    query: String,
    module: String? = null,
    type: String? = null,
    kind: DocKind? = null,
    offset: Int? = null,
    limit: Int? = null,
): DocSearch {
    val args =
        if (module == null && type == null && kind == null && offset == null && limit == null) {
            ggArgs(ggText(query))
        } else {
            val options = ggRecord()
            if (module != null) {
                ggSet(options, "module", ggText(module))
            }
            if (type != null) {
                ggSet(options, "type", ggText(type))
            }
            if (kind != null) {
                ggSet(options, "kind", ggText(kind.wireName))
            }
            if (offset != null) {
                ggSet(options, "offset", ggNumber(offset))
            }
            if (limit != null) {
                ggSet(options, "limit", ggNumber(limit))
            }
            ggArgs(ggText(query), options)
        }
    return Read.docSearch(ggCall("search", docsObject(), "gg.docs", "search", args))
}

/**
 * Take one documentation view back out of the context window, by the key it was opened under.
 *
 * A plain removal with no cascade: closing a function's view leaves the views of the types it named
 * exactly where they were, and closing a type's leaves the functions. A key that is not open closes
 * `0` rather than failing, so a program that tidies up unconditionally needs no guard, and a type
 * closed here is opened again by the next function that mentions it.
 *
 * @ggop docs.close
 * @param key The fully-qualified name the view was opened under, as [DocHit.key] reports it.
 * @return how many views were closed, which is one unless it had already gone
 * @throws ToolError `UNAVAILABLE` for an agent this run did not give the closing of documentation
 *   views. Opening one only ever appends to the end of the prompt, while closing one rewrites its
 *   middle, which is why opening is always available and closing is bought.
 */
public fun close(key: String): Int =
    ggAsInteger(ggCall("close", docsObject(), "gg.docs", "close", ggArgs(ggText(key))))

/**
 * Take every documentation view out of the context window at once.
 *
 * The blanket form of [close], on the same terms and behind the same capability: no cascade to worry
 * about because nothing is left, and `0` rather than a failure when none was open. It is the call
 * for reclaiming the window between one piece of work and the next, where naming each key would be a
 * list to keep.
 *
 * @ggop docs.close_all
 * @return how many views went
 * @throws ToolError `UNAVAILABLE` for an agent this run did not give the closing of documentation
 *   views.
 */
public fun closeAll(): Int =
    ggAsInteger(ggCall("close_all", docsObject(), "gg.docs", "closeAll", ggArgs()))

/**
 * Which of the two things a documentation entry describes.
 *
 * The taxonomy is closed at two because a surface is functions and the types their signatures name: a
 * module is a heading, and a parameter is documented on the function that takes it.
 *
 * @property wireName gg's own word for this kind, which is what the filter is sent as.
 */
public enum class DocKind(public val wireName: String) {
    /** A function a program calls. */
    FUNCTION("function"),

    /** A type a signature names. */
    TYPE("type"),
}

/**
 * One entry a search matched: enough to choose from, and no more.
 *
 * @property key The fully-qualified name it is documented under, and what `gg.views.openDocsView`
 *   takes to read the whole of it.
 * @property kind Whether this entry is a function or a type.
 * @property module The module it lives in, and never one this agent holds nothing in.
 *
 *   A function has exactly one; a type has every module whose functions mention it, joined by
 *   commas, which makes it a description rather than something to hand back as [search]'s `module`.
 * @property name The name a program calls it by, or the type's own name.
 * @property summary Its brief, and only its brief. Everything else written about it is what a
 *   documentation view holds.
 */
public data class DocHit(
    val key: String,
    val kind: DocKind,
    val module: String,
    val name: String,
    val summary: String,
)

/**
 * One page of search results, and the total behind it.
 *
 * @property total How many entries matched before paging, so a capped page is not read as a whole
 *   answer.
 * @property offset The offset this page starts at, echoed back, so paging needs nothing tracked on
 *   the side.
 * @property hits The page itself, best first.
 */
public data class DocSearch(val total: Int, val offset: Int, val hits: List<DocHit>)
