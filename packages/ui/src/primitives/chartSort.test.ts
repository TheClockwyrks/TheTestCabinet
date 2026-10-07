import { describe, expect, it } from "vitest";
import { orderBars } from "./chartSort";

// A bar reduced to what the comparator reads: its label and its charted value.
interface Bar {
  label: string;
  value: number | null;
}

const bar = (label: string, value: number | null): Bar => ({ label, value });
const labelOf = (b: Bar): string => b.label;
const valueOf = (b: Bar): number | null => b.value;
const labels = (bars: readonly Bar[]): string[] => bars.map(labelOf);

describe("orderBars — alphabetical", () => {
  it("orders by label whatever the metric says", () => {
    const ordered = orderBars(
      [bar("zeta", 1), bar("alpha", 99), bar("mid", 50)],
      "alphabetical",
      labelOf,
      valueOf,
      "lower",
    );
    expect(labels(ordered)).toEqual(["alpha", "mid", "zeta"]);
  });

  it("leaves the caller's array untouched", () => {
    const input = [bar("zeta", 1), bar("alpha", 2)];
    orderBars(input, "alphabetical", labelOf, valueOf, "lower");
    expect(labels(input)).toEqual(["zeta", "alpha"]);
  });
});

describe("orderBars — best", () => {
  it("puts the smallest first when lower is better (cost, tokens)", () => {
    const ordered = orderBars(
      [bar("pricey", 9), bar("cheap", 1), bar("mid", 5)],
      "best",
      labelOf,
      valueOf,
      "lower",
    );
    expect(labels(ordered)).toEqual(["cheap", "mid", "pricey"]);
  });

  it("puts the largest first when higher is better (points)", () => {
    const ordered = orderBars(
      [bar("few", 1), bar("many", 9), bar("some", 5)],
      "best",
      labelOf,
      valueOf,
      "higher",
    );
    expect(labels(ordered)).toEqual(["many", "some", "few"]);
  });

  it("sorts an unmeasured bar last in either direction", () => {
    // A bar we can't measure has not earned a place among the ones we can — and
    // must not be read as a zero, which under `lower` would rank it best.
    expect(
      labels(
        orderBars(
          [bar("unknown", null), bar("known", 5)],
          "best",
          labelOf,
          valueOf,
          "lower",
        ),
      ),
    ).toEqual(["known", "unknown"]);
    expect(
      labels(
        orderBars(
          [bar("unknown", null), bar("known", 5)],
          "best",
          labelOf,
          valueOf,
          "higher",
        ),
      ),
    ).toEqual(["known", "unknown"]);
  });

  it("splits a tie on the metric by mean points, highest first", () => {
    const points = new Map([
      ["weak", 3],
      ["strong", 18],
    ]);
    const ordered = orderBars(
      [bar("weak", 5), bar("strong", 5)],
      "best",
      labelOf,
      valueOf,
      "lower",
      (label) => points.get(label) ?? null,
    );
    expect(labels(ordered)).toEqual(["strong", "weak"]);
  });

  it("ranks a bar with no points behind one that has them", () => {
    const ordered = orderBars(
      [bar("unscored", 5), bar("scored", 5)],
      "best",
      labelOf,
      valueOf,
      "lower",
      (label) => (label === "scored" ? 1 : null),
    );
    expect(labels(ordered)).toEqual(["scored", "unscored"]);
  });

  it("falls back to the label when the metric and the points are both level", () => {
    // Otherwise the order would depend on the input order, and two charts fed
    // the same roster in different orders would disagree.
    const ordered = orderBars(
      [bar("zeta", 5), bar("alpha", 5)],
      "best",
      labelOf,
      valueOf,
      "lower",
      () => 7,
    );
    expect(labels(ordered)).toEqual(["alpha", "zeta"]);
  });
});
