import { useCallback, useEffect, useState } from "react";

/** Which way a sorted column runs. */
export type SortDirection = "asc" | "desc";

/**
 * The active sort of a table: the id of the column it's ordered by and the
 * direction, or null for the table's natural (default) order — recency for a run
 * log, catalog order for the model list.
 */
export interface SortState {
  columnId: string;
  direction: SortDirection;
}

interface TableSort {
  /** The active sort, or null for the table's default order. */
  sort: SortState | null;
  /**
   * Advance the sort on a header click. Clicking a column cycles it through
   * ascending → descending → off (back to the default order); clicking a
   * different column starts it ascending.
   */
  cycle: (columnId: string) => void;
}

function load(storageKey: string): SortState | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof (parsed as SortState).columnId === "string" &&
      ((parsed as SortState).direction === "asc" ||
        (parsed as SortState).direction === "desc")
    ) {
      return { ...(parsed as SortState) };
    }
  } catch {
    // Corrupt or unavailable storage: fall back to the default order.
  }
  return null;
}

function save(storageKey: string, sort: SortState | null): void {
  if (typeof localStorage === "undefined") return;
  try {
    if (sort === null) localStorage.removeItem(storageKey);
    else localStorage.setItem(storageKey, JSON.stringify(sort));
  } catch {
    // Non-fatal: the sort just won't survive a reload.
  }
}

/**
 * Sort state for a click-to-sort table, persisted under `storageKey` so a user's
 * chosen ordering survives navigation and reloads. The comparators themselves
 * live with each table's columns; this hook owns only the state and the
 * three-way header-click cycle (ascending → descending → default).
 */
export function useTableSort(storageKey: string): TableSort {
  const [sort, setSort] = useState<SortState | null>(() => load(storageKey));

  useEffect(() => {
    save(storageKey, sort);
  }, [storageKey, sort]);

  const cycle = useCallback((columnId: string) => {
    setSort((current) => {
      if (!current || current.columnId !== columnId) {
        return { columnId, direction: "asc" };
      }
      if (current.direction === "asc") {
        return { columnId, direction: "desc" };
      }
      return null;
    });
  }, []);

  return { sort, cycle };
}

function compareKeys(a: string | number, b: string | number): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b));
}

/**
 * Order rows by the active sort, or return a copy in their given (default) order
 * when there is none. `sortKeyFor` maps a column id to the key extractor for that
 * column (or undefined when it isn't sortable). Unknown keys (null) always sort
 * last, in either direction, so a descending sort never floats blanks to the top,
 * and the sort is stable — rows that compare equal keep their incoming order.
 */
export function sortRows<T>(
  rows: readonly T[],
  sort: SortState | null,
  sortKeyFor: (columnId: string) => ((row: T) => string | number | null) | undefined,
): T[] {
  if (!sort) return [...rows];
  const key = sortKeyFor(sort.columnId);
  if (!key) return [...rows];
  const decorated = rows.map((row, index) => ({ row, index, value: key(row) }));
  decorated.sort((a, b) => {
    const aNull = a.value == null;
    const bNull = b.value == null;
    if (aNull || bNull) {
      if (aNull && bNull) return a.index - b.index;
      return aNull ? 1 : -1;
    }
    // Both non-null here (the guard above returned otherwise); TS can't narrow
    // across the two decorated objects, so assert it.
    const base = compareKeys(a.value as string | number, b.value as string | number);
    if (base !== 0) return sort.direction === "asc" ? base : -base;
    return a.index - b.index;
  });
  return decorated.map((entry) => entry.row);
}

/** The `aria-sort` value for a header cell, given the table's active sort. */
export function ariaSortFor(
  columnId: string,
  sort: SortState | null,
): "ascending" | "descending" | "none" {
  if (!sort || sort.columnId !== columnId) return "none";
  return sort.direction === "asc" ? "ascending" : "descending";
}
