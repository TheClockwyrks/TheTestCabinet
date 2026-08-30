// Arc Foundry — `pathing.no-corner-cut`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `pathing/no-corner-cut.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. A diagonal step is permitted only when both orthogonally
// adjacent tiles it cuts past are crossable: with two diagonally touching
// walls placed so only the corner gap joins the two sides, the route goes
// around them and the maze length rises rather than threading the gap.
//
// HOW IT IS DECIDED. Wall a diagonal pinch and compare the reported maze
// length against the length a corner cut would give. The evidence it hands
// back is `pinch` (image): the diagonal pinch the route refuses to cut.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("pathing.no-corner-cut", () => {
  it("The Load never squeezes through a diagonal corner gap", () => {
    fail(
      "a validator deciding this point",
      "the suite for `pathing.no-corner-cut` has not been written yet",
    );
  });
});
