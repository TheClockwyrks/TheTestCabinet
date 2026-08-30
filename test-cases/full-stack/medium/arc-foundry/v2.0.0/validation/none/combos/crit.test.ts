// Arc Foundry — `combos.crit`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `combos/crit.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. A tower carrying crit rolls the stated chance on each shot
// off the game's seeded generator, and a shot that crits removes critMult
// times its damage instead of its damage: over a long run at a fixed seed both
// figures appear and neither is any other value.
//
// HOW IT IS DECIDED. Park a frozen invincible target under a Slag Driver and
// record the damage of every shot over a long run at a fixed seed. The
// evidence it hands back is `crit` (replay): the critical hit among the
// ordinary ones.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("combos.crit", () => {
  it("A crit deals its multiplier of the shot's damage", () => {
    fail(
      "a validator deciding this point",
      "the suite for `combos.crit` has not been written yet",
    );
  });
});
