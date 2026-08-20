/**
 * Find a module, function or type by searching, and take a documentation view back out of the window.
 *
 * This is where a session starts. The system prompt names the modules and no function inside them,
 * so searching — by keyword, or by naming modules, which is an exact lookup of everything in them —
 * is how a program learns what this agent actually holds. A search answers with one-line briefs;
 * reading one of them in full means opening a documentation view of its `key`, which
 * `gg.views.openDocsView` does.
 *
 * Nothing a search returns is something this agent cannot call. gg filters every hit through the
 * same permission the call itself is checked against, so what is findable here and what is usable
 * are one set — while the type checker, which reads the whole catalogue, will accept a call to a
 * function this run withheld.
 *
 * Closing a documentation view is bought by a capability; searching and opening never are.
 */

import * as raw from "test-cabinet:gg/docs";
import { U32_MAX, arrayArg, call, opts, uint } from "../internal/errors.js";

/** Which of the three things a documentation entry is. */
export type DocKind =
  /** A module a program imports, whose functions live inside it. */
  | "module"
  /** A function a program calls. */
  | "function"
  /** A type a signature names. */
  | "type";

/** One entry a search matched: enough to choose from, and no more. */
export interface DocHit {
  /** The fully-qualified name it is documented under, and what `gg.views.openDocsView` takes. */
  key: string;

  /** Whether this entry is a module, a function or a type. */
  kind: DocKind;

  /**
   * The module it lives in, written the way a program writes it.
   *
   * One module, always: the module that **publishes** a function, the module that **declares** a
   * type, and, for a module, itself. A type mentioned by half the surface still reports the one
   * place it is defined, so this is never a list and never a description — it is a value to hand
   * straight back to the `modules` filter, which is how one interesting hit becomes everything
   * filed beside it.
   */
  module: string;

  /** The name a program calls it by, the type's own name, or the module's path. */
  name: string;

  /** Its brief, and only its brief. Everything else written about it is what a view holds. */
  summary: string;
}

/** One page of search results, and the total behind it. */
export interface DocSearch {
  /** How many entries matched before paging, so a capped page is distinguishable from a whole one. */
  total: number;

  /** The offset this page starts at, echoed back, so paging needs nothing tracked on the side. */
  offset: number;

  /** The page itself, best first. */
  hits: DocHit[];
}

/**
 * Search the modules this agent holds, everything it can call, and every type their signatures name.
 *
 * Best match first, and a hit is one of three things: a **module** a program imports, a function it
 * calls, or a type a signature names. The module is what a search wants first — nothing gg offers is
 * in scope until the program has imported the module the function lives in.
 *
 * Matching is case-insensitive substring matching over names, signatures, briefs and detailed
 * descriptions, so `docs` finds `openDocsView`. A hit whose own name matched is ranked above one
 * that merely mentions the word in a paragraph, and the query is split on whitespace, so several
 * specific words work better than a sentence.
 *
 * Nothing here is required, the filters compose with the query and with each other, and each filter
 * is an exact lookup rather than another thing to rank: `modules` on its own, with no query, is
 * those modules' whole directory, which is the first hop worth making. What is refused is asking
 * for nothing at all — no query and no filter — because a search that found nothing and a search
 * that was never given anything to look for are different answers.
 *
 * The page comes back as a value **and** opens as a view labelled `search results`, so the results
 * can be read next turn without being shown deliberately. That view is replaced by the next search
 * rather than accumulating, and `gg.views.close("search results")` takes it away.
 *
 * @ggop docs.search
 * @param options The words to look for, the filters, and the page. Every field is optional, and
 * omitting the object entirely asks for nothing, which is the one way this call is refused.
 * @param options.query The words to look for, as one string. Several specific words beat a sentence;
 * it may be left out only when a filter says what to look at instead.
 * @param options.modules The modules to look in, each named either the way a program writes it
 * (`gg.files`) or by gg's own id (`files`). Exact and case-insensitive, and several are a **union**
 * — an entry in any one of them is a hit — so one call reads the whole of the surface this agent
 * was given. An empty list is no module filter at all.
 * @param options.type One type's own name, narrowing to that type and the functions whose signatures
 * mention it — what can be done with a value of this shape.
 * @param options.kind `"module"`, `"function"` or `"type"`, to see only one of them. Any other word
 * is refused.
 * @param options.offset How many hits to skip, for reading past the first page. Defaults to none.
 * @param options.limit How many hits to return: 20 by default, 100 at most, and zero is refused.
 * Compare it against `total` to see how much of the answer this page is.
 * @returns one page of hits, best first, beside the `total` that says how much of the answer it is.
 * @throws `ApiError` with `invalid-argument` for a search carrying neither a query nor a filter — a
 * search that asked for nothing and a search that found nothing are different answers — for an
 * unrecognised `kind`, which would otherwise silently widen a search believed to be narrow, and for
 * a `limit` of zero, which is a page that could answer nothing.
 */
export function search(options?: {
  query?: string;
  modules?: string[];
  type?: string;
  kind?: DocKind;
  offset?: number;
  limit?: number;
}): DocSearch {
  const o = opts<{
    query?: string;
    modules?: string[];
    type?: string;
    kind?: DocKind;
    offset?: number;
    limit?: number;
  }>("search", options);
  const modules = arrayArg("search", "modules", o?.modules);
  const offset = uint("search", "offset", o?.offset, U32_MAX);
  const limit = uint("search", "limit", o?.limit, U32_MAX);
  return call(() => {
    const page = raw.search(o?.query, modules, o?.type, o?.kind, offset, limit);
    return {
      total: page.total,
      offset: page.offset,
      // The membrane declares `kind` a bare string, because the WIT record does; gg writes exactly
      // the three words this union carries, and the narrowing is here so a program branching on a
      // hit gets the closed set rather than `string`.
      hits: page.hits.map((hit) => ({ ...hit, kind: hit.kind as DocKind })),
    };
  });
}

/**
 * Close the documentation view opened under `key`.
 *
 * A key that is not open is not a failure, so tidying up unconditionally needs no guard. There is no
 * cascade: closing a function's view leaves the views of the types it named exactly where they were,
 * and closing a type's leaves the functions. Nothing remembers why a view was opened, so a type
 * closed here is opened again by the next function that mentions it.
 *
 * Opening a view only ever appends to the end of the prompt, while closing one rewrites its middle
 * and costs the run every cached token after it — which is why opening is always available and
 * closing is bought.
 *
 * @ggop docs.close
 * @param key The fully-qualified name the view was opened under, as a search hit reports it.
 * @returns how many views were closed, which is zero when that key was not open.
 * @throws `ApiError` with `unavailable` for an agent this run did not give the closing of
 * documentation views.
 */
export function close(key: string): number {
  // A `u32`, so already a `number` — nothing to widen on the way back.
  return call(() => raw.closeDocView(key));
}

/**
 * Close every documentation view at once.
 *
 * The blanket form of `close`, on the same terms and behind the same capability, with no cascade to
 * worry about because nothing is left. It is the call for reclaiming the window between one piece of
 * work and the next, where naming each key would be a list to keep.
 *
 * @ggop docs.close_all
 * @returns how many views went, which is zero when none was open.
 * @throws `ApiError` with `unavailable` for an agent this run did not give the closing of
 * documentation views.
 */
export function closeAll(): number {
  return call(() => raw.closeDocViews());
}
