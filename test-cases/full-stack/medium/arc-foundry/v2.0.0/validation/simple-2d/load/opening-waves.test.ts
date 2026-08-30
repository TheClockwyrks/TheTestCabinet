// Arc Foundry — `load.opening-waves`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `load/opening-waves.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. The first three waves of a run release Motes and Sparks and
// nothing else.
//
// HOW IT IS DECIDED. Play the first three waves and record the type of every
// unit released. The evidence it hands back is `opening` (replay): the opening
// wave's composition.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("load.opening-waves", () => {
  it("Waves 1 through 3 carry Motes and Sparks only", () => {
    fail(
      "a validator deciding this point",
      "the suite for `load.opening-waves` has not been written yet",
    );
  });
});
