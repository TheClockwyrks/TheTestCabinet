import { describe, expect, it } from "vitest";
import { formatPoints, formatWeight } from "./ratings";

// The scoring and aggregation rules this module used to own now live in
// `@clockwyrks/run-stats`, and their tests moved with them
// (packages/run-stats/src/scoring.test.ts). What remains here is the display
// formatting the UI kept.

describe("formatPoints", () => {
  it("shows whole numbers as-is and trims fractional trailing zeros", () => {
    expect(formatPoints(2)).toBe("2");
    expect(formatPoints(0.5)).toBe("0.5");
    expect(formatPoints(1 / 3)).toBe("0.33");
  });

  it('never shows a ".0" suffix but keeps non-zero decimals', () => {
    // Review items are integer-weighted, so a whole score reads "5", not "5.0";
    // a fraction that *rounds* to a whole trims away too, while a genuinely
    // non-zero fractional part stays.
    expect(formatPoints(5.0)).toBe("5");
    expect(formatPoints(5.001)).toBe("5");
    expect(formatPoints(5.1)).toBe("5.1");
    expect(formatPoints(14.5)).toBe("14.5");
  });
});

describe("formatWeight", () => {
  it("names the unit, singular only for exactly one point", () => {
    expect(formatWeight(1)).toBe("1 pt");
    expect(formatWeight(2)).toBe("2 pts");
    expect(formatWeight(0)).toBe("0 pts");
    // A fractional weight reads through formatPoints and is never "one".
    expect(formatWeight(0.5)).toBe("0.5 pts");
    expect(formatWeight(1 / 3)).toBe("0.33 pts");
  });
});
