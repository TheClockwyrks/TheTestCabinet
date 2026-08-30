// Arc Foundry — `quality.damage-scales`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `quality/damage-scales.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. Every firing base type reports baseDamage *
// QUALITY_MULT[tier] at each of the five tiers, with QUALITY_MULT [1, 3, 9,
// 40, 110], so a Capacitor reads 6, 18, 54, 240, 660 and a Discharge Rig 18,
// 54, 162, 720, 1980.
//
// HOW IT IS DECIDED. Stand each of the seven firing types at each of the five
// tiers and hold the reported damage against the table. The evidence it hands
// back is `ladder` (image): the quality ladder standing on the yard.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("quality.damage-scales", () => {
  it("Damage is the base damage times QUALITY_MULT", () => {
    fail(
      "a validator deciding this point",
      "the suite for `quality.damage-scales` has not been written yet",
    );
  });
});
