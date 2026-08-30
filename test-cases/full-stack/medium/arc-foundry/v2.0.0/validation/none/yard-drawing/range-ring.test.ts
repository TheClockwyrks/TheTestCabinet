// Arc Foundry — `yard-drawing.range-ring`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `yard-drawing/range-ring.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. Selecting a firing structure draws a ring at its reported
// range: pixels sampled on the ring differ from the same points with nothing
// selected by more than 50 of 441 in RGB distance, and the ring's radius
// follows the structure's range across two tiers.
//
// HOW IT IS DECIDED. Select structures at two tiers and sample the yard at
// each reported radius with and without the selection. The evidence it hands
// back is `ring` (image): the range ring on a selected structure.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("yard-drawing.range-ring", () => {
  it("A range ring is drawn on the held or selected structure", () => {
    fail(
      "a validator deciding this point",
      "the suite for `yard-drawing.range-ring` has not been written yet",
    );
  });
});
