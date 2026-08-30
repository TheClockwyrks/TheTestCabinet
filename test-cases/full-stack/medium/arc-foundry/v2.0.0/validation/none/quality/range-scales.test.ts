// Arc Foundry — `quality.range-scales`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `quality/range-scales.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. Every firing base type reports baseRange + RANGE_PER_TIER *
// (tier - 1), with RANGE_PER_TIER 8, so a Capacitor reads 100, 108, 116, 124,
// 132 and a Discharge Rig 160 through 192.
//
// HOW IT IS DECIDED. Stand each of the seven firing types at each of the five
// tiers and hold the reported range against the table. The evidence it hands
// back is `ladder` (image): the ranges across the quality ladder.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("quality.range-scales", () => {
  it("Range is the base range plus 8 per tier", () => {
    fail(
      "a validator deciding this point",
      "the suite for `quality.range-scales` has not been written yet",
    );
  });
});
