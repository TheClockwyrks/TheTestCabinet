import { describe, expect, it } from "vitest";
import { formatPoints } from "./ratings";

// The scoring and aggregation rules this module used to own now live in
// `@test-cabinet/run-stats`, and their tests moved with them
// (packages/run-stats/src/scoring.test.ts). What remains here is the display
// formatting the UI kept.

describe("formatPoints", () => {
  it("shows whole numbers as-is and trims fractional trailing zeros", () => {
    expect(formatPoints(2)).toBe("2");
    expect(formatPoints(0.5)).toBe("0.5");
    expect(formatPoints(1 / 3)).toBe("0.33");
  });
});
