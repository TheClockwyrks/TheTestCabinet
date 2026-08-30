// Arc Foundry — `load.wave-one-health`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `load/wave-one-health.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. The surcharge is exactly 0 at wave 1, so a unit's maximum
// health there is round(baseHP * baseMult): on Medium a Mote's 44 * 0.22 =
// 9.68 is 10 and a Filament's 74 * 0.22 = 16.28 is 16.
//
// HOW IT IS DECIDED. Set wave 1 on Medium, release each type, and hold each
// maxHp against the product. The evidence it hands back is `wave1` (image):
// the wave-one Load at its opening health.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("load.wave-one-health", () => {
  it("At wave 1 health is round(baseHP * baseMult)", () => {
    fail(
      "a validator deciding this point",
      "the suite for `load.wave-one-health` has not been written yet",
    );
  });
});
