import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { usePagedSearchParams, useResetPageOnChange } from "./usePagedSearchParams";

const wrapper =
  (initialEntries: string[] = ["/"]) =>
  ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={initialEntries}>{children}</MemoryRouter>
  );

// Mirror how a list page wires the two hooks together: the paged params own the
// URL, and the reset is keyed on the out-of-URL inputs (sort/scope).
function useHarness(resetKey: string) {
  const paged = usePagedSearchParams();
  useResetPageOnChange(paged.setPage, resetKey);
  return paged;
}

describe("useResetPageOnChange", () => {
  it("keeps the page when only the page changes (regression: reset fired on every navigation)", () => {
    const { result, rerender } = renderHook(({ key }) => useHarness(key), {
      wrapper: wrapper(),
      initialProps: { key: "date:desc" },
    });
    expect(result.current.page).toBe(0);

    act(() => result.current.setPage(1));
    // `setPage`'s identity changes on the resulting URL change; the reset must not
    // treat that as a key change and snap back to page 0.
    rerender({ key: "date:desc" });
    expect(result.current.page).toBe(1);
  });

  it("resets to the first page when the key actually changes", () => {
    const { result, rerender } = renderHook(({ key }) => useHarness(key), {
      wrapper: wrapper(),
      initialProps: { key: "date:desc" },
    });

    act(() => result.current.setPage(2));
    expect(result.current.page).toBe(2);

    rerender({ key: "name:asc" });
    expect(result.current.page).toBe(0);
  });

  it("does not reset a page restored from a shared link on mount", () => {
    const { result } = renderHook(({ key }) => useHarness(key), {
      wrapper: wrapper(["/?page=3"]),
      initialProps: { key: "date:desc" },
    });
    // 1-based `?page=3` → 0-based index 2, preserved rather than reset to 0.
    expect(result.current.page).toBe(2);
  });
});
