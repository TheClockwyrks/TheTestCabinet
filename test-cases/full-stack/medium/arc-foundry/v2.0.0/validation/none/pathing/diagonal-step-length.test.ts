// Arc Foundry — `pathing.diagonal-step-length`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `pathing/diagonal-step-length.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. The maze length of a yard whose route is forced through a
// counted number of orthogonal and diagonal steps is the sum of those step
// lengths, 1 per orthogonal step and about 1.4142 per diagonal, so length
// rather than step count is what the route minimizes.
//
// HOW IT IS DECIDED. Wall a corridor whose least route is a known mix of steps
// and hold the reported maze length against the computed sum. The evidence it
// hands back is `route` (image): the walled corridor whose route length is
// read.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("pathing.diagonal-step-length", () => {
  it("A diagonal step counts sqrt(2) and an orthogonal step 1", () => {
    fail(
      "a validator deciding this point",
      "the suite for `pathing.diagonal-step-length` has not been written yet",
    );
  });
});
