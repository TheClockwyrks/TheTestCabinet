import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { ariaSortFor, sortRows, useTableSort, type SortState } from "./useTableSort";

interface Row {
  id: string;
  n: number | null;
}

const keyFor = (
  columnId: string,
): ((row: Row) => string | number | null) | undefined =>
  columnId === "n" ? (row) => row.n : undefined;

describe("sortRows", () => {
  const rows: Row[] = [
    { id: "a", n: 3 },
    { id: "b", n: 1 },
    { id: "c", n: 2 },
  ];

  it("returns a copy in the given order when there is no sort", () => {
    const out = sortRows(rows, null, keyFor);
    expect(out.map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(out).not.toBe(rows);
  });

  it("orders ascending and descending", () => {
    const asc: SortState = { columnId: "n", direction: "asc" };
    const desc: SortState = { columnId: "n", direction: "desc" };
    expect(sortRows(rows, asc, keyFor).map((r) => r.id)).toEqual([
      "b",
      "c",
      "a",
    ]);
    expect(sortRows(rows, desc, keyFor).map((r) => r.id)).toEqual([
      "a",
      "c",
      "b",
    ]);
  });

  it("keeps null keys last in both directions", () => {
    const withNulls: Row[] = [
      { id: "a", n: 2 },
      { id: "b", n: null },
      { id: "c", n: 1 },
    ];
    const asc = sortRows(
      withNulls,
      { columnId: "n", direction: "asc" },
      keyFor,
    );
    const desc = sortRows(
      withNulls,
      { columnId: "n", direction: "desc" },
      keyFor,
    );
    expect(asc.map((r) => r.id)).toEqual(["c", "a", "b"]);
    expect(desc.map((r) => r.id)).toEqual(["a", "c", "b"]);
  });

  it("is stable — equal keys keep their incoming order", () => {
    const ties: Row[] = [
      { id: "a", n: 1 },
      { id: "b", n: 1 },
      { id: "c", n: 1 },
    ];
    const out = sortRows(
      ties,
      { columnId: "n", direction: "desc" },
      keyFor,
    );
    expect(out.map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("leaves rows untouched when the column isn't sortable", () => {
    const out = sortRows(
      rows,
      { columnId: "missing", direction: "asc" },
      keyFor,
    );
    expect(out.map((r) => r.id)).toEqual(["a", "b", "c"]);
  });
});

describe("useTableSort", () => {
  beforeEach(() => localStorage.clear());

  it("cycles a column ascending → descending → off", () => {
    const { result } = renderHook(() => useTableSort("k"));
    expect(result.current.sort).toBeNull();
    act(() => result.current.cycle("a"));
    expect(result.current.sort).toEqual({ columnId: "a", direction: "asc" });
    act(() => result.current.cycle("a"));
    expect(result.current.sort).toEqual({ columnId: "a", direction: "desc" });
    act(() => result.current.cycle("a"));
    expect(result.current.sort).toBeNull();
  });

  it("starts a different column ascending", () => {
    const { result } = renderHook(() => useTableSort("k"));
    act(() => result.current.cycle("a"));
    act(() => result.current.cycle("a")); // a desc
    act(() => result.current.cycle("b"));
    expect(result.current.sort).toEqual({ columnId: "b", direction: "asc" });
  });

  it("persists the sort under its key", () => {
    const first = renderHook(() => useTableSort("k"));
    act(() => first.result.current.cycle("a"));
    const second = renderHook(() => useTableSort("k"));
    expect(second.result.current.sort).toEqual({
      columnId: "a",
      direction: "asc",
    });
  });
});

describe("ariaSortFor", () => {
  it("maps the active column's direction and 'none' otherwise", () => {
    expect(ariaSortFor("a", null)).toBe("none");
    expect(ariaSortFor("a", { columnId: "b", direction: "asc" })).toBe("none");
    expect(ariaSortFor("a", { columnId: "a", direction: "asc" })).toBe(
      "ascending",
    );
    expect(ariaSortFor("a", { columnId: "a", direction: "desc" })).toBe(
      "descending",
    );
  });
});
