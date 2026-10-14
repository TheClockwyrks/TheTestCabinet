import { useEffect, useMemo } from "react";
import type { PagedSearchParams } from "./usePagedSearchParams";

/** One page of a list the page already holds whole. */
export interface ClientPage<T> {
  /** The page actually shown: the requested one, held inside the list. */
  current: number;
  /** How many pages the list fills, never fewer than one. */
  pageCount: number;
  /** The items of the current page, in the list's own order. */
  items: T[];
  /** The 1-based position of the page's first item, 0 for an empty list. */
  from: number;
  /** The 1-based position of the page's last item. */
  to: number;
}

/**
 * Slice a list the page holds whole into the URL's page (see
 * {@link usePagedSearchParams}), for the listings that are read in one response
 * and paged here rather than by the backend.
 *
 * The slice follows the list's own order and is recomputed from it on every read,
 * so an item keeps its page across a refresh for as long as the items ahead of it
 * stay. A list that shrinks under the requested page (a filter, a delete, a live
 * board moving) shows its last page at once and corrects the URL with `replace`,
 * which leaves no phantom Back stop. `ready` holds that correction back while the
 * list is still loading, so a pasted `?page=3` survives the empty first render.
 */
export function useClientPage<T>(
  list: readonly T[],
  pageSize: number,
  page: number,
  setPage: PagedSearchParams["setPage"],
  ready = true,
): ClientPage<T> {
  const pageCount = Math.max(1, Math.ceil(list.length / pageSize));
  const current = Math.min(page, pageCount - 1);

  useEffect(() => {
    if (ready && page > pageCount - 1)
      setPage(pageCount - 1, { replace: true });
  }, [ready, page, pageCount, setPage]);

  const items = useMemo(
    () => list.slice(current * pageSize, (current + 1) * pageSize),
    [list, current, pageSize],
  );
  const from = list.length === 0 ? 0 : current * pageSize + 1;
  return { current, pageCount, items, from, to: from + items.length - 1 };
}

/**
 * The line beside a client-paged list's filters: which items the page shows, of how
 * many. While a filter narrows the list it counts the matches and names the whole
 * list after them, so "of 14" is never read as the size of the list itself.
 */
export function showingLabel(
  page: Pick<ClientPage<unknown>, "from" | "to">,
  matched: number,
  total: number,
  noun: string,
): string {
  const plural = (n: number) => `${n} ${n === 1 ? noun : `${noun}s`}`;
  if (matched === 0) return `0 of ${plural(total)}`;
  const range =
    page.from === page.to ? `${page.from}` : `${page.from}–${page.to}`;
  return matched === total
    ? `Showing ${range} of ${plural(total)}`
    : `Showing ${range} of ${matched} matching (${plural(total)})`;
}
