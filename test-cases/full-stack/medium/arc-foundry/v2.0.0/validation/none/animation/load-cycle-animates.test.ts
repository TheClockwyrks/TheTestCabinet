// Arc Foundry — `animation.load-cycle-animates`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `animation/load-cycle-animates.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. The pixels drawn over a travelling unit differ between two
// frames a quarter of a second apart with the unit held at one position, so
// the idle cycle loops rather than holding frame 0.
//
// HOW IT IS DECIDED. Freeze a unit's travel, advance a quarter second, and
// compare the pixels drawn over it. The evidence it hands back is `cycle`
// (replay): the Load cycle playing on a held unit.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("animation.load-cycle-animates", () => {
  it("A Load cycle plays while a unit travels", () => {
    fail(
      "a validator deciding this point",
      "the suite for `animation.load-cycle-animates` has not been written yet",
    );
  });
});
