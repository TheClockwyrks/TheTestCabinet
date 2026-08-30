// Arc Foundry — `campaign.wave-clears`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `campaign/wave-clears.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. A wave clears exactly when every unit it released has died
// or leaked: with one unit still on the yard the phase still reads wave, and
// the frame that unit is removed the phase becomes build.
//
// HOW IT IS DECIDED. Hold one released unit frozen, confirm the wave is still
// live, release it, and read the phase after it grounds out. The evidence it
// hands back is `clear` (replay): the wave clearing on its last unit.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("campaign.wave-clears", () => {
  it("A wave clears when its last unit has gone", () => {
    fail(
      "a validator deciding this point",
      "the suite for `campaign.wave-clears` has not been written yet",
    );
  });
});
