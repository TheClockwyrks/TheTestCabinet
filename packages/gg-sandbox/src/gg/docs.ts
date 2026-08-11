/**
 * Find a function by searching for it, and take a documentation view back out of the window.
 *
 * This is where a session starts. The system prompt names the modules and no function inside them,
 * so searching — by keyword, or by naming a module, which is an exact lookup of everything in it —
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
import { U32_MAX, call, opts, uint } from "../internal/errors.js";

/** Which of the two things a documentation entry is. */
export type DocKind =
  /** A function a program calls. */
  | "function"
  /** A type a signature names. */
  | "type";

/** One entry a search matched: enough to choose from, and no more. */
export interface DocHit {
  /** The fully-qualified name it is documented under, and what `gg.views.openDocsView` takes. */
  key: string;

  /** Whether this entry is a function or a type. */
  kind: DocKind;

  /**
   * The module it lives in, written the way a program writes it.
   *
   * A function has exactly one. A **type** has as many as there are modules whose functions mention
   * it, and they arrive comma-separated — so this is a description rather than something to hand
   * back to the `module` filter, which takes one module and nothing else.
   */
  module: string;

  /** The name a program calls it by, or the type's own name. */
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
 * Search everything this agent can call, and every type their signatures name, best match first.
 *
 * Matching is case-insensitive substring matching over names, signatures, briefs and detailed
 * descriptions, so `docs` finds `openDocsView`. A hit whose own name matched is ranked above one
 * that merely mentions the word in a paragraph, and the query is split on whitespace, so several
 * specific words work better than a sentence.
 *
 * The filters compose with the query and with each other, and each is an exact lookup rather than
 * another thing to rank: an empty query with `module` is that module's whole directory, which is the
 * first hop worth making. A query that is blank **and** carries no filter is `invalid-argument`,
 * because a search that asked for nothing and a search that found nothing are different answers; so
 * is an unrecognised `kind`, which would otherwise silently widen a search believed to be narrow.
 *
 * The page comes back as a value **and** opens as a view labelled `search results`, so the results
 * can be read next turn without being shown deliberately. That view is replaced by the next search
 * rather than accumulating, and `gg.views.close("search results")` takes it away.
 *
 * @ggop docs.search
 * @param query The words to look for, as one string. Several specific words beat a sentence; it may
 * be empty only when a filter says what to look at instead.
 * @param options The filters and the page. Omit it for the first page of everything the query
 * ranked.
 * @param options.module One module, named either the way a program writes it (`gg.files`) or by
 * gg's own id (`files`). Exact and case-insensitive.
 * @param options.type One type's own name, narrowing to that type and the functions whose signatures
 * mention it — what can be done with a value of this shape.
 * @param options.kind `"function"` or `"type"`, to see only one of them. Any other word is refused.
 * @param options.offset How many hits to skip, for reading past the first page. Defaults to none.
 * @param options.limit How many hits to return: 20 by default, 100 at most, and zero is refused.
 * Compare it against `total` to see how much of the answer this page is.
 */
export function search(
  query: string,
  options?: {
    module?: string;
    type?: string;
    kind?: DocKind;
    offset?: number;
    limit?: number;
  },
): DocSearch {
  const o = opts<{
    module?: string;
    type?: string;
    kind?: DocKind;
    offset?: number;
    limit?: number;
  }>("search", options);
  const offset = uint("search", "offset", o?.offset, U32_MAX);
  const limit = uint("search", "limit", o?.limit, U32_MAX);
  return call(() => {
    const page = raw.search(query, o?.module, o?.type, o?.kind, offset, limit);
    return {
      total: page.total,
      offset: page.offset,
      // The membrane declares `kind` a bare string, because the WIT record does; gg writes exactly
      // the two words this union carries, and the narrowing is here so a program branching on a hit
      // gets the closed set rather than `string`.
      hits: page.hits.map((hit) => ({ ...hit, kind: hit.kind as DocKind })),
    };
  });
}

/**
 * Close the documentation view opened under `key`, and hand back how many were closed.
 *
 * A key that is not open closes zero rather than failing, so tidying up unconditionally needs no
 * guard. There is no cascade: closing a function's view leaves the views of the types it named
 * exactly where they were, and closing a type's leaves the functions. Nothing remembers why a view
 * was opened, so a type closed here is opened again by the next function that mentions it.
 *
 * Throws `ToolError` with `unavailable` for an agent this run did not give the closing of
 * documentation views. Opening one only ever appends to the end of the prompt, while closing one
 * rewrites its middle and costs the run every cached token after it — which is why opening is
 * always available and closing is bought.
 *
 * @ggop docs.close
 * @param key The fully-qualified name the view was opened under, as a search hit reports it.
 */
export function close(key: string): number {
  // A `u32`, so already a `number` — nothing to widen on the way back.
  return call(() => raw.closeDocView(key));
}

/**
 * Close every documentation view at once, and hand back how many went.
 *
 * The blanket form of `close`, on the same terms and behind the same capability: no cascade to
 * worry about because nothing is left, and zero rather than a failure when none was open. It is the
 * call for reclaiming the window between one piece of work and the next, where naming each key would
 * be a list to keep.
 *
 * Throws `ToolError` with `unavailable` for an agent this run did not give the closing of
 * documentation views.
 *
 * @ggop docs.close_all
 */
export function closeAll(): number {
  return call(() => raw.closeDocViews());
}
