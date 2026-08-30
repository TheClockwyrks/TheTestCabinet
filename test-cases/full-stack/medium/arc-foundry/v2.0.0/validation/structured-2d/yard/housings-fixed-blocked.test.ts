// Arc Foundry — `yard.housings-fixed-blocked`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `yard/housings-fixed-blocked.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. On The Transformer Yard the two housing rectangles — col
// 12-19 by row 6-12 and col 30-37 by row 20-26 — are Fixed-blocked: a
// placement covering any of their tiles is refused, and the base waypoint
// chain still has an open route around both.
//
// HOW IT IS DECIDED. Attempt a placement inside each housing rectangle and
// read the maze length of the empty map back. The evidence it hands back is
// `housings` (image): a refused placement on a transformer housing.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("yard.housings-fixed-blocked", () => {
  it("The Transformer Yard's housings are fixed and unbuildable", () => {
    fail(
      "a validator deciding this point",
      "the suite for `yard.housings-fixed-blocked` has not been written yet",
    );
  });
});
