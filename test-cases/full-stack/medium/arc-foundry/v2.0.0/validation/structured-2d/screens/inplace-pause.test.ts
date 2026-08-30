// Arc Foundry — `screens.inplace-pause`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `screens/inplace-pause.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. Pausing in place on playing leaves the screen reading
// playing with paused true, holds simTime and every unit's position still over
// ten seconds, and draws no menu over the yard.
//
// HOW IT IS DECIDED. Pause in place mid-wave, advance ten seconds, and compare
// simTime and the unit positions. The evidence it hands back is `paused`
// (replay): the yard frozen under an in-place pause.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("screens.inplace-pause", () => {
  it("The in-place pause freezes the yard without a menu", () => {
    fail(
      "a validator deciding this point",
      "the suite for `screens.inplace-pause` has not been written yet",
    );
  });
});
