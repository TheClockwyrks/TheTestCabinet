import { describe, expect, it } from "vitest";
import { quantile, summarizeValues } from "./distribution";

// The quartile convention is not a free choice: the comparison charts cut theirs
// in Rust (`crate::comparison_stats::quantile`) and the gg query evaluator cuts
// its own in the browser, and all three have to land on the same number or two
// views of one set of runs would draw different boxes. These pin the convention
// by example.
describe("quantile", () => {
  it("interpolates linearly between the neighbouring observations", () => {
    // Positions in [0, n-1]: q1 sits at 0.5 (between 1 and 2), q3 at 1.5
    // (between 2 and 9). A nearest-rank convention would answer 1 and 9.
    const sorted = [1, 2, 9];
    expect(quantile(sorted, 0.25)).toBe(1.5);
    expect(quantile(sorted, 0.5)).toBe(2);
    expect(quantile(sorted, 0.75)).toBe(5.5);
  });

  it("returns an exact observation when the rank lands on one", () => {
    expect(quantile([2, 4, 6, 8, 10], 0.5)).toBe(6);
    expect(quantile([2, 4, 6, 8, 10], 0)).toBe(2);
    expect(quantile([2, 4, 6, 8, 10], 1)).toBe(10);
  });

  it("collapses to the single observation at n = 1", () => {
    // The distribution has no width, and every quantile of it is that one run.
    expect(quantile([7], 0.25)).toBe(7);
    expect(quantile([7], 0.5)).toBe(7);
    expect(quantile([7], 0.75)).toBe(7);
  });

  it("clamps a quantile outside [0, 1] rather than reading off the ends", () => {
    expect(quantile([1, 2, 3], -1)).toBe(1);
    expect(quantile([1, 2, 3], 5)).toBe(3);
  });

  it("has no answer for an empty sample", () => {
    expect(quantile([], 0.5)).toBeNaN();
  });
});

describe("summarizeValues", () => {
  it("summarizes a sample on the documented statistics", () => {
    expect(summarizeValues([9, 1, 2])).toEqual({
      n: 3,
      mean: 4,
      median: 2,
      min: 1,
      max: 9,
      q1: 1.5,
      q3: 5.5,
    });
  });

  it("reports the mean and the median separately on a skewed sample", () => {
    // Cost and tokens are right-skewed, and the gap between the two figures is
    // itself informative — a summary that reported only one would hide it.
    const stats = summarizeValues([1, 1, 1, 1, 96])!;
    expect(stats.median).toBe(1);
    expect(stats.mean).toBe(20);
  });

  it("collapses a single run to a point rather than a zero-width spread", () => {
    expect(summarizeValues([5])).toEqual({
      n: 1,
      mean: 5,
      median: 5,
      min: 5,
      max: 5,
      q1: 5,
      q3: 5,
    });
  });

  it("returns no summary at all for an empty sample", () => {
    // A view then says "no runs" rather than drawing a fabricated zero.
    expect(summarizeValues([])).toBeNull();
  });

  it("leaves the caller's array alone", () => {
    const values = [9, 1, 2];
    summarizeValues(values);
    expect(values).toEqual([9, 1, 2]);
  });
});
