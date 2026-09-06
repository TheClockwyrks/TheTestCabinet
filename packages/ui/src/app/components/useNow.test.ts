import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useNow } from "./useNow";

const T0 = Date.parse("2026-01-05T00:00:00Z");

describe("useNow", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });
  afterEach(() => vi.useRealTimers());

  it("advances once a second while it is enabled", () => {
    const { result } = renderHook(() => useNow(true));
    expect(result.current).toBe(T0);
    act(() => void vi.advanceTimersByTime(2_500));
    expect(result.current).toBe(T0 + 2_000);
  });

  it("creates no timer at all when nothing is live", () => {
    // The flag is the whole point: a log of finished rows must cost exactly what it
    // did before the ticker existed, so the clock is frozen AND no interval exists.
    const { result } = renderHook(() => useNow(false));
    act(() => void vi.advanceTimersByTime(10_000));
    expect(result.current).toBe(T0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("re-reads the clock the moment it goes live again", () => {
    // A surface that sat idle while time passed must not show a stale first second
    // when a run appears on it.
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useNow(enabled),
      { initialProps: { enabled: false } },
    );
    act(() => void vi.advanceTimersByTime(30_000));
    rerender({ enabled: true });
    expect(result.current).toBe(T0 + 30_000);
  });

  it("drops its interval when it stops being live", () => {
    const { rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useNow(enabled),
      { initialProps: { enabled: true } },
    );
    expect(vi.getTimerCount()).toBe(1);
    rerender({ enabled: false });
    expect(vi.getTimerCount()).toBe(0);
  });
});
