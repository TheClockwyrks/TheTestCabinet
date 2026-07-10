import { describe, expect, it } from "vitest";
import type { ReviewVerdict } from "@test-cabinet/run-record/review";
import {
  formatPoints,
  scoreChecklist,
  subItemVerdictId,
  verdictIdsForItem,
  type WeightedItem,
} from "./ratings";

const pass = (id: string): ReviewVerdict => ({ id, status: "pass" });
const fail = (id: string): ReviewVerdict => ({ id, status: "fail" });

// These mirror the Rust core's review scoring tests (crates/core/src/review.test.rs);
// keeping the two in lockstep is what lets the site score runs the same way the
// backend does.
describe("scoreChecklist with sub-items", () => {
  it("scores a whole-item pass as its full weight", () => {
    const items: WeightedItem[] = [
      { id: "a", weight: 2 },
      { id: "b", weight: 3 },
    ];
    const score = scoreChecklist(items, [pass("a"), fail("b")]);
    expect(score).toEqual({ earned: 2, total: 5 });
  });

  it("credits the fraction of an item's sub-items that passed", () => {
    const items: WeightedItem[] = [
      { id: "plain", weight: 2 },
      {
        id: "spin",
        weight: 4,
        subItems: [{ id: "stationary" }, { id: "moving" }],
      },
    ];
    // plain earns 2; spin earns 4 * 1/2 = 2 of its 4. Total 6.
    const score = scoreChecklist(items, [
      pass("plain"),
      pass("spin.stationary"),
      fail("spin.moving"),
    ]);
    expect(score.total).toBe(6);
    expect(score.earned).toBeCloseTo(4);
  });

  it("is all-or-nothing at the extremes and proportional between", () => {
    const items: WeightedItem[] = [
      { id: "q", weight: 1, subItems: [{ id: "a" }, { id: "b" }, { id: "c" }] },
    ];
    expect(
      scoreChecklist(items, [pass("q.a"), pass("q.b"), pass("q.c")]).earned,
    ).toBeCloseTo(1);
    expect(
      scoreChecklist(items, [fail("q.a"), fail("q.b"), fail("q.c")]).earned,
    ).toBe(0);
    expect(
      scoreChecklist(items, [pass("q.a"), fail("q.b"), fail("q.c")]).earned,
    ).toBeCloseTo(1 / 3);
  });
});

describe("verdict id helpers", () => {
  it("composes a sub-item verdict id as `<item>.<sub>`", () => {
    expect(subItemVerdictId("spin", "moving")).toBe("spin.moving");
  });

  it("expands an item to its own id, or one composite per sub-item", () => {
    expect(verdictIdsForItem({ id: "plain" })).toEqual(["plain"]);
    expect(
      verdictIdsForItem({ id: "spin", subItems: [{ id: "a" }, { id: "b" }] }),
    ).toEqual(["spin.a", "spin.b"]);
  });
});

describe("formatPoints", () => {
  it("shows whole numbers as-is and trims fractional trailing zeros", () => {
    expect(formatPoints(2)).toBe("2");
    expect(formatPoints(0.5)).toBe("0.5");
    expect(formatPoints(1 / 3)).toBe("0.33");
  });
});
