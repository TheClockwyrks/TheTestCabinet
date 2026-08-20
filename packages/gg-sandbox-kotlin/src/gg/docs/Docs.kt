/**
 * Search this surface for a module, function or type, and take a documentation view back out of the window.
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

import gg.core.ApiError
import gg.internal.Read
import gg.internal.ggCall
import gg.internal.ggList
import gg.internal.ggNumber
import gg.internal.ggText
import gg.internal.ggTexts

/**
 * Find what this agent can call, by keyword or by module, and read the briefs that come back.
 *
 * Matching is case-insensitive substring matching over names, signatures, briefs and detailed
 * descriptions, so `"docs"` finds `openDocsView`. A hit whose own name matched ranks above one
 * that merely mentions the word in a paragraph, and the query is split on whitespace, so several
 * specific words work better than a sentence.
 *
 * The filters compose with the query and with each other, and each is an exact lookup rather than
 * another thing to rank: [modules] with no query beside it is those modules' whole directory, all of
 * them at once, which is the first hop worth making.
 *
 * The page comes back as a value *and* opens as a view, so the results can be read on the next turn
 * without being shown deliberately. The next search replaces that view: it names what is being
 * worked from rather than keeping a record.
 *
 * @ggop docs.search
 * @param query The words to look for, as one string. Several specific words beat a sentence; it is
 *   left out only when a filter says what to look at instead.
 * @param modules The modules to look in, each named either the way a program writes it (`gg.files`)
 *   or by gg's own id (`files`). Exact and case-insensitive: a module filter is a lookup, so a name
 *   no module has matches nothing rather than failing. Several are a **union** — an entry in any one
 *   of them is a hit — and naming none looks in every module this agent holds.
 * @param type One type's own name — `"FileRead"`, not the key it is documented under — narrowing
 *   to that type and to the functions whose signatures mention it. Like [modules] a lookup, so a
 *   name nothing declares matches nothing rather than failing.
 * @param kind Narrow to modules, to functions or to types. Left out, all three are searched.
 * @param offset How many hits to skip, for reading past the first page. Left out, the page starts at
 *   the first hit.
 * @param limit How many hits to return: 20 by default, 100 at most, and zero is refused. Compare it
 *   against [DocSearch.total] to see how much of the answer this page is.
 * @return one page of matches, best first, and the total behind it
 * @throws ApiError `INVALID_ARGUMENT` for a call carrying neither a query nor a filter — a search
 *   that asked for nothing and a search that found nothing are different answers, and this is the
 *   one way asking for nothing is refused — and for a [limit] of zero, which is a page that could
 *   answer nothing.
 */
public fun search(
    query: String? = null,
    modules: List<String>? = null,
    type: String? = null,
    kind: DocKind? = null,
    offset: Int? = null,
    limit: Int? = null,
): DocSearch =
    Read.docSearch(
        ggCall(
            "docs.search",
            ggText(query),
            if (modules == null) ggList() else ggTexts(modules),
            ggText(type),
            ggText(kind?.wireName),
            ggNumber(offset),
            ggNumber(limit),
        ),
    )

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
 * @throws ApiError `UNAVAILABLE` for an agent this run did not give the closing of documentation
 *   views. Opening one only ever appends to the end of the prompt, while closing one rewrites its
 *   middle, which is why opening is always available and closing is bought.
 */
public fun close(key: String): Int = ggCall("docs.close", ggText(key)).integer()

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
 * @throws ApiError `UNAVAILABLE` for an agent this run did not give the closing of documentation
 *   views.
 */
public fun closeAll(): Int = ggCall("docs.close_all").integer()

/**
 * Which of the three things a documentation entry describes.
 *
 * A surface is the modules a program imports, the functions inside them, and the types their
 * signatures name. A parameter is not one of them: it is documented on the function that takes it.
 *
 * @property wireName gg's own word for this kind, which is what the filter is sent as.
 */
public enum class DocKind(public val wireName: String) {
    /** A module a program imports, and whose functions live inside it. */
    MODULE("module"),

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
 * @property kind Whether this entry is a module, a function or a type.
 * @property module The module it lives in: the one publishing a function or declaring a type.
 *   Exactly one, and a [search] filter takes it.
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
