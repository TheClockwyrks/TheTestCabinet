// Arc Foundry — `firing.projectile-orphaned`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `firing/projectile-orphaned.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. A projectile whose target is removed before it arrives is
// removed with it and deals no damage: no other unit standing on its path
// loses health.
//
// HOW IT IS DECIDED. Fire at a frozen unit, clear the units mid-flight with a
// second unit parked on the path, and read the second unit's health. The
// evidence it hands back is `orphan` (replay): the projectile removed with its
// target.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("firing.projectile-orphaned", () => {
  it("A projectile whose target is gone deals nothing", () => {
    fail(
      "a validator deciding this point",
      "the suite for `firing.projectile-orphaned` has not been written yet",
    );
  });
});
