// Arc Foundry — `press.placement-is-free`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `press/placement-is-free.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. Charge is unchanged across a placement: the five-per-level
// allowance is the only limit on how many rocks a level places.
//
// HOW IT IS DECIDED. Read Charge either side of five drops. The evidence it
// hands back is `hud` (image): the HUD across a free placement.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("press.placement-is-free", () => {
  it("Placing a rock is free", () => {
    fail(
      "a validator deciding this point",
      "the suite for `press.placement-is-free` has not been written yet",
    );
  });
});
