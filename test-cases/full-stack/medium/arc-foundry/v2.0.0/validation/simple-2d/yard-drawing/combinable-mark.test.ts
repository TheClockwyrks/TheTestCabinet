// Arc Foundry — `yard-drawing.combinable-mark`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `yard-drawing/combinable-mark.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. Every base structure that could combine right now is marked
// on the yard whether or not it is selected: the pixels sampled at a structure
// with a matching partner standing differ from the same structure with no
// partner by more than 50 of 441 in RGB distance, with nothing selected in
// either case.
//
// HOW IT IS DECIDED. Sample a structure with and without a matching partner on
// the yard, selection cleared. The evidence it hands back is `marked` (image):
// the marked combinable pair.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("yard-drawing.combinable-mark", () => {
  it("A combinable structure is marked without being selected", () => {
    fail(
      "a validator deciding this point",
      "the suite for `yard-drawing.combinable-mark` has not been written yet",
    );
  });
});
