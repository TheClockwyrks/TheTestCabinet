// The time range.
//
// It scopes the query without being *in* the query, which is what lets a dashboard put one
// picker over a whole board — and what keeps a relative range relative: the range is
// resolved to absolute milliseconds at the moment a query runs, so the server needs no
// clock and a saved view re-resolves on every run.
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_RANGE,
  TIME_RANGES,
  TimeRangePicker,
  rangeById,
  rangeFilter,
} from "./TimeRangePicker";

const NOW = Date.UTC(2026, 6, 31, 12, 0);

describe("resolving a range", () => {
  it("bounds `started`, and only from below", () => {
    // `started`, not `finished`: a run still going has no finish timestamp, so bounding on
    // that would quietly exclude exactly the runs "last 24 hours" is asked about.
    const filter = rangeFilter(rangeById("24h"), NOW);
    expect(filter).toEqual({
      kind: "range",
      field: "started",
      from: NOW - 86_400_000,
    });
  });

  it("resolves against the injected instant, never a hidden clock", () => {
    // The property that makes a saved relative range work: the same range yields different
    // absolute milliseconds on different days, and the *text* never changes.
    const monday = rangeFilter(rangeById("30d"), NOW);
    const friday = rangeFilter(rangeById("30d"), NOW + 4 * 86_400_000);
    expect(monday).not.toEqual(friday);
  });

  it("adds no clause at all for the unbounded range", () => {
    expect(rangeFilter(rangeById("all"), NOW)).toBeNull();
  });

  it("falls back to the default for a stale or hand-edited token", () => {
    expect(rangeById("nonsense")).toBe(DEFAULT_RANGE);
    expect(rangeById(null)).toBe(DEFAULT_RANGE);
    // All time, not a recent window: gg runs are recorded in bursts, so a surface opening
    // on "last 7 days" would greet most operators with an empty result.
    expect(DEFAULT_RANGE.id).toBe("all");
  });

  it("returns the same object for the same token, so it is a stable memo key", () => {
    expect(rangeById("30d")).toBe(rangeById("30d"));
  });
});

describe("the interval each range carries", () => {
  it("gives every range an explicit histogram width", () => {
    // There is deliberately no `auto` interval in TCQ: it has no representation in a
    // compiled query and is unresolvable client-side for a query with no time bound. The
    // presets carry the width instead, so it always exists.
    for (const range of TIME_RANGES) {
      expect(range.interval.count).toBeGreaterThan(0);
      expect(["minute", "hour", "day", "week"]).toContain(range.interval.unit);
    }
  });

  it("widens the bucket as the range widens", () => {
    expect(rangeById("24h").interval).toEqual({ count: 1, unit: "hour" });
    expect(rangeById("30d").interval).toEqual({ count: 1, unit: "day" });
    expect(rangeById("1y").interval).toEqual({ count: 1, unit: "week" });
  });
});

describe("the control", () => {
  it("offers every range and reports the picked one", () => {
    const onChange = vi.fn();
    render(<TimeRangePicker value={DEFAULT_RANGE} onChange={onChange} />);
    const select = screen.getByLabelText("Time range");
    expect(screen.getAllByRole("option")).toHaveLength(TIME_RANGES.length);
    fireEvent.change(select, { target: { value: "30d" } });
    expect(onChange).toHaveBeenCalledWith(rangeById("30d"));
  });
});
