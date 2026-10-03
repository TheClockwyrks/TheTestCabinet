import { describe, expect, it } from "vitest";
import {
  ineligibleReason,
  isIneligible,
  rungEligibility,
} from "./rungEligibility";

// The console's mirror of the backend's author-time check: a rung must pin a
// validator-rated version, because a ladder's gate reads validator ratings only.
describe("rungEligibility", () => {
  it("accepts a version on the engine format", () => {
    expect(
      rungEligibility({ engineFormat: true, testType: "end-to-end" }),
    ).toEqual({ kind: "eligible" });
  });

  it("refuses a legacy version, whose rating only a reviewer supplies", () => {
    const e = rungEligibility({ engineFormat: false, testType: "end-to-end" });
    expect(e).toEqual({ kind: "legacy" });
    expect(isIneligible(e)).toBe(true);
    expect(ineligibleReason(e)).toMatch(/rated only by a reviewer/);
  });

  it("names the more specific cause for a performance or game-jam case", () => {
    for (const testType of ["performance", "game-jam"] as const) {
      const e = rungEligibility({ engineFormat: true, testType });
      expect(e).toEqual({ kind: "ineligibleType", testType });
      expect(isIneligible(e)).toBe(true);
    }
    expect(
      ineligibleReason({ kind: "ineligibleType", testType: "game-jam" }),
    ).toMatch(/game jam/);
  });

  // The backend allows a version it has not ingested, so the console does too: the
  // driver reports a missing version better than a guess here can.
  it("allows a version that did not resolve, and one still resolving", () => {
    expect(rungEligibility(null)).toEqual({ kind: "unknown" });
    expect(isIneligible({ kind: "unknown" })).toBe(false);
    expect(isIneligible(undefined)).toBe(false);
    expect(ineligibleReason(undefined)).toBeNull();
  });
});
