import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { useDebouncedValue } from "./useDebouncedValue";

// The query-string keys the paginated lists carry their view in. Page is stored
// 1-based (so a shared link reads `?page=3`, matching what the pager shows) and
// converted to the 0-based index the pages compute offsets with; the free-text
// filter travels as `q`. Both are omitted at their defaults (page 1, empty
// filter) to keep the common URL clean, and each of these lists lives under its
// own route so the shared `page`/`q` namespace never collides between them.
const PAGE_PARAM = "page";
const QUERY_PARAM = "q";

function readPage(params: URLSearchParams): number {
  const raw = params.get(PAGE_PARAM);
  if (!raw) return 0;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 1 ? n - 1 : 0;
}

export interface PagedSearchParams {
  /** The current page as a 0-based index (parsed from the 1-based `?page=`). */
  page: number;
  /**
   * Navigate to a 0-based page. A user page change pushes a new history entry so
   * Back returns to the previous page; automatic corrections (reset-on-filter,
   * clamp-out-of-range) pass `{ replace: true }` so they leave no phantom stop.
   * Page 0 drops the param to keep the first page's URL clean.
   */
  setPage: (page: number, options?: { replace?: boolean }) => void;
  /**
   * The immediate filter text, for the search input's `value`. It updates on
   * every keystroke for responsiveness; the URL follows only once typing settles.
   */
  query: string;
  /** Update the immediate filter text (the URL `q` follows after the debounce). */
  setQuery: (text: string) => void;
  /**
   * The settled filter text reflected in the URL — the value a server-paged list
   * should actually query on (it lags `query` by the debounce, which is the point).
   */
  committedQuery: string;
}

interface Options {
  /** How long the filter must settle before it is written to the URL. */
  debounceMs?: number;
}

/**
 * Keep a paginated list's page and filter in the URL so navigating pages (and
 * typing a filter) is reflected in the address bar and a pasted link restores the
 * same view. Wraps {@link useSearchParams}: the page rides in a 1-based `?page=`
 * (converted to the 0-based index the lists use) and the filter in `?q=`, both
 * omitted at their defaults.
 *
 * The filter is debounced before it reaches the URL: keystrokes update `query`
 * immediately (so the input stays responsive) and only the settled value is
 * written, with `replace`, so fast typing does not flood the history. Committing
 * a new filter also drops back to page 1. For the reset-to-first the *other*
 * inputs need — sort and scope, which live outside the URL and are only known
 * after the run table is built — pair this with {@link useResetPageOnChange}.
 */
export function usePagedSearchParams(options: Options = {}): PagedSearchParams {
  const { debounceMs = 250 } = options;
  const [params, setParams] = useSearchParams();
  const page = readPage(params);
  const committedQuery = params.get(QUERY_PARAM) ?? "";

  const setPage = useCallback(
    (next: number, opts?: { replace?: boolean }) => {
      setParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          if (next <= 0) p.delete(PAGE_PARAM);
          else p.set(PAGE_PARAM, String(next + 1));
          return p;
        },
        { replace: opts?.replace ?? false },
      );
    },
    [setParams],
  );

  // The immediate input value, seeded from the URL and re-synced below when the
  // URL filter changes out from under it (Back/Forward, or a freshly pasted link).
  // `useState`'s setter has a stable identity, so the adopt effect can depend on it.
  const [query, setQuery] = useState(committedQuery);
  const debounced = useDebouncedValue(query, debounceMs);

  // Track the last filter WE pushed, so the adopt effect can tell an external URL
  // change (which it should mirror into the input) from the echo of our own write
  // (which it must ignore, or it would clobber whatever the user has since typed).
  const lastWritten = useRef(committedQuery);

  // Push the settled filter into the URL. `debounced === query` means typing has
  // settled (so a half-typed value is never written, and the transient right after
  // an adopt — when `query` has jumped but `debounced` still trails — is skipped);
  // the `!== committedQuery` guard makes the write idempotent, so this can't loop.
  useEffect(() => {
    if (debounced !== query || debounced === committedQuery) return;
    lastWritten.current = debounced;
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        if (debounced) p.set(QUERY_PARAM, debounced);
        else p.delete(QUERY_PARAM);
        // A new filter reshapes the result set, so fall back to the first page.
        p.delete(PAGE_PARAM);
        return p;
      },
      { replace: true },
    );
  }, [debounced, query, committedQuery, setParams]);

  // Adopt an external URL filter change into the input (Back/Forward, a link),
  // but ignore the echo of our own debounced write so in-flight typing is safe.
  useEffect(() => {
    if (committedQuery !== lastWritten.current) {
      lastWritten.current = committedQuery;
      setQuery(committedQuery);
    }
  }, [committedQuery, setQuery]);

  return { page, setPage, query, setQuery, committedQuery };
}

/**
 * Send a paginated list back to its first page whenever `resetKey` changes — the
 * signature of the inputs that reshape the result set but do not live in the URL
 * (the active sort; the model or variant a list is scoped to). It never fires on
 * the initial render, so a page restored from a shared `?page=` link survives;
 * the reset replaces the history entry so it leaves no phantom Back stop.
 *
 * This is a separate hook (rather than an option of {@link usePagedSearchParams})
 * because `resetKey` is only known once the run table has resolved the active
 * sort, which itself needs the page the paged-params hook returns.
 */
export function useResetPageOnChange(
  setPage: PagedSearchParams["setPage"],
  resetKey: string,
): void {
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setPage(0, { replace: true });
  }, [resetKey, setPage]);
}
