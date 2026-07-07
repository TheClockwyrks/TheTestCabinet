import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useColumnVisibility } from "./useColumnVisibility";

const COLUMNS = [
  { id: "name" }, // mandatory (not optional)
  { id: "provider", optional: true }, // optional, default visible
  { id: "timestamp", optional: true, defaultVisible: false }, // optional, default hidden
];

describe("useColumnVisibility", () => {
  beforeEach(() => localStorage.clear());

  it("shows non-optional columns and honors each optional default", () => {
    const { result } = renderHook(() => useColumnVisibility("k", COLUMNS));
    expect(result.current.isVisible("name")).toBe(true);
    expect(result.current.isVisible("provider")).toBe(true);
    expect(result.current.isVisible("timestamp")).toBe(false);
  });

  it("toggles an optional column and ignores non-optional ones", () => {
    const { result } = renderHook(() => useColumnVisibility("k", COLUMNS));
    act(() => result.current.toggle("timestamp"));
    expect(result.current.isVisible("timestamp")).toBe(true);
    act(() => result.current.toggle("provider"));
    expect(result.current.isVisible("provider")).toBe(false);
    act(() => result.current.toggle("name")); // no-op: mandatory
    expect(result.current.isVisible("name")).toBe(true);
  });

  it("persists only explicit overrides, so a new column keeps its own default", () => {
    const first = renderHook(() => useColumnVisibility("k", COLUMNS));
    act(() => first.result.current.toggle("timestamp")); // now shown
    // Stored overrides shouldn't pin columns the user never touched.
    const raw = JSON.parse(localStorage.getItem("k") ?? "{}");
    expect(raw).toEqual({ timestamp: true });

    const second = renderHook(() => useColumnVisibility("k", COLUMNS));
    expect(second.result.current.isVisible("timestamp")).toBe(true);
    expect(second.result.current.isVisible("provider")).toBe(true);
  });

  it("drops the override when a toggle returns to the default", () => {
    const { result } = renderHook(() => useColumnVisibility("k", COLUMNS));
    act(() => result.current.toggle("provider")); // hide (override)
    act(() => result.current.toggle("provider")); // back to default -> override cleared
    expect(localStorage.getItem("k")).toBeNull();
    expect(result.current.isVisible("provider")).toBe(true);
  });
});
