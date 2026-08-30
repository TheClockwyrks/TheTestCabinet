// Arc Foundry — `load.health-is-a-whole-number`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `load/health-is-a-whole-number.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. A unit's maximum health is the bracketed real rounded to
// the nearest integer with an exact half rounding up, so every reported maxHp
// is an integer at every wave and every difficulty, and a Wave-1 Medium Mote
// reads exactly 10 where a Filament reads 16.
//
// HOW IT IS DECIDED. Sample maxHp across many waves and all three difficulties
// and hold each against the rounded formula. The evidence it hands back is
// `rounding` (image): the rounded health the Load carries.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("load.health-is-a-whole-number", () => {
  it("Maximum health is a whole number", () => {
    fail(
      "a validator deciding this point",
      "the suite for `load.health-is-a-whole-number` has not been written yet",
    );
  });
});
