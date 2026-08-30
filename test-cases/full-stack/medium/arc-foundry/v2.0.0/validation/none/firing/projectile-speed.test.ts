// Arc Foundry — `firing.projectile-speed`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `firing/projectile-speed.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. A launched projectile starts at the structure's centre and
// covers PROJECTILE_SPEED (520) logical units of ground per second of
// simulation time while it travels.
//
// HOW IT IS DECIDED. Fire one shot at a distant frozen unit and sample the
// projectile's position across its flight. The evidence it hands back is
// `flight` (replay): the projectile in flight.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("firing.projectile-speed", () => {
  it("A projectile leaves the centre at PROJECTILE_SPEED", () => {
    fail(
      "a validator deciding this point",
      "the suite for `firing.projectile-speed` has not been written yet",
    );
  });
});
