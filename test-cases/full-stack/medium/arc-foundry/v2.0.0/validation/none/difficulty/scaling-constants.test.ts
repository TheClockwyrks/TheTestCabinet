// Arc Foundry — `difficulty.scaling-constants`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `difficulty/scaling-constants.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. A unit's maximum health at a given wave follows the formula
// with that difficulty's baseMult, k, c and r — 0.20, 0.50, 0.08, 1.09 on
// Easy, 0.22, 1.17, 0.28, 1.145 on Medium and 0.24, 1.30, 0.22, 1.15 on Hard —
// so the same unit at the same wave differs across the three.
//
// HOW IT IS DECIDED. Release the same type at the same wave under each
// difficulty and hold each maxHp against that difficulty's constants. The
// evidence it hands back is `scaling` (image): the same wave under three
// difficulties.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("difficulty.scaling-constants", () => {
  it("Each difficulty scales health by its own constants", () => {
    fail(
      "a validator deciding this point",
      "the suite for `difficulty.scaling-constants` has not been written yet",
    );
  });
});
