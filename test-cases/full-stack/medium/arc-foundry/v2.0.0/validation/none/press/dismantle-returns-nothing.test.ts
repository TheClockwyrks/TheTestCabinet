// Arc Foundry — `press.dismantle-returns-nothing`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `press/dismantle-returns-nothing.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. Dismantling a structure of any kind returns no Charge and
// no stamp, including a candidate placed the same phase, so a roll cannot be
// reclaimed and re-rolled.
//
// HOW IT IS DECIDED. Read Charge and stampsLeft either side of dismantling a
// candidate and a component. The evidence it hands back is `hud` (image): the
// HUD across a no-refund dismantle.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("press.dismantle-returns-nothing", () => {
  it("Dismantle returns nothing", () => {
    fail(
      "a validator deciding this point",
      "the suite for `press.dismantle-returns-nothing` has not been written yet",
    );
  });
});
