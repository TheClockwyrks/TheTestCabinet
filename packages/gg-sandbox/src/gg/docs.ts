/**
 * Find a module, function or type by searching, and close a documentation view.
 *
 * The system prompt names the modules and no function inside them; searching by keyword, or by
 * naming modules, lists what this session holds. A search answers with one-line briefs, and an
 * entry's full text is what a documentation view of its `key` holds.
 *
 * Every hit is a call this session can make: gg filters hits through the same permission the call
 * itself is checked against. The type checker reads the whole catalogue instead, and accepts a call
 * to a function this run withheld.
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
  /**
   * The fully-qualified name it is documented under, and the key a documentation view is opened by.
   */
  key: string;

  /** Whether this entry is a module, a function or a type. */
  kind: DocKind;

  /**
   * The module it lives in, written the way a program writes it.
   *
   * One module, always: the module that publishes a function, the module that declares a type,
   * and, for a module, itself. A type mentioned by several modules still reports the one place it is
   * defined. The value is accepted by the `modules` filter as written.
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
 * Search the modules this session holds, every function it can call, and every type their signatures name.
 *
 * Best match first. A hit is a module a program imports, a function it calls, or a type a signature
 * names. Nothing gg offers is in scope until the program has imported the module the function lives
 * in.
 *
 * Matching is case-insensitive substring matching over names, signatures, briefs and detailed
 * descriptions. A hit whose own name matched ranks above one that mentions the word in a paragraph,
 * and the query is split on whitespace into separate terms.
 *
 * Every field is optional, and the filters compose with the query and with each other. Each filter
 * is an exact lookup rather than a ranking term, so `modules` with no query is those modules' whole
 * directory. A call carrying neither a query nor a filter is refused.
 *
 * The page comes back as a value and opens as a view labelled `search results`, which the next
 * search replaces.
 *
 * @ggop docs.search
 * @param options The words to look for, the filters, and the page. Every field is optional;
 * omitting the object entirely is refused.
 * @param options.query The words to look for, as one string. It may be left out when a filter says
 * what to look at instead.
 * @param options.modules The modules to look in, each named either the way a program writes it
 * (`gg.files`) or by gg's own id (`files`). Exact and case-insensitive, and several are a union: an
 * entry in any one of them is a hit. An empty list is no module filter at all.
 * @param options.type One type's own name, narrowing to that type and the functions whose signatures
 * mention it.
 * @param options.kind `"module"`, `"function"` or `"type"`, to see only one of them. Any other word
 * is refused.
 * @param options.offset How many hits to skip. Defaults to none.
 * @param options.limit How many hits to return: 20 by default, 100 at most, and zero is refused.
 * @returns one page of hits, best first, beside the `total` that says how many matched before
 * paging.
 * @throws `ApiError` with `invalid-argument` for a search carrying neither a query nor a filter, for
 * an unrecognised `kind`, and for a `limit` of zero.
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
 * A key that is not open is not a failure. There is no cascade: closing a function's view leaves the
 * views of the types it named open, and closing a type's leaves the functions. A type closed here is
 * opened again by the next function that mentions it.
 *
 * @ggop docs.close
 * @param key The fully-qualified name the view was opened under, as a search hit reports it.
 * @returns how many views were closed, which is zero when that key was not open.
 * @throws `ApiError` with `unavailable` when this run did not enable the closing of documentation
 * views.
 */
export function close(key: string): number {
  // A `u32`, so already a `number` — nothing to widen on the way back.
  return call(() => raw.closeDocView(key));
}

/**
 * Close every documentation view at once.
 *
 * @ggop docs.close_all
 * @returns how many views went, which is zero when none was open.
 * @throws `ApiError` with `unavailable` when this run did not enable the closing of documentation
 * views.
 */
export function closeAll(): number {
  return call(() => raw.closeDocViews());
}
