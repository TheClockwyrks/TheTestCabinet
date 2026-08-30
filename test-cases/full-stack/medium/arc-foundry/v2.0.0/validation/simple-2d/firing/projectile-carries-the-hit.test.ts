// Arc Foundry — `firing.projectile-carries-the-hit`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `firing/projectile-carries-the-hit.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. The target loses no health while the projectile is in
// flight: the damage lands on the update the projectile comes within
// PROJECTILE_HIT_R (6) of the target's position, and the projectile is removed
// on that same update.
//
// HOW IT IS DECIDED. Fire one shot at a distant frozen unit and sample its
// health every frame of the flight. The evidence it hands back is `hit`
// (replay): the shot connecting with the unit.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("firing.projectile-carries-the-hit", () => {
  it("The projectile carries the hit", () => {
    fail(
      "a validator deciding this point",
      "the suite for `firing.projectile-carries-the-hit` has not been written yet",
    );
  });
});
