// Arc Foundry — `abilities.aura-buffs-in-radius`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `abilities/aura-buffs-in-radius.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. A firing structure whose centre lies within REGULATOR_AURA
// radius of a Regulator — 90 at Scrap rising 6 a tier — reports (1 +
// auraBonus) times its damage, unrounded, and removes that much health per
// shot.
//
// HOW IT IS DECIDED. Stand a Scrap Regulator beside a Scrap Capacitor and read
// the Capacitor's reported damage and the health one shot removes. The
// evidence it hands back is `aura` (replay): the buffed structure inside the
// aura.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("abilities.aura-buffs-in-radius", () => {
  it("A Regulator's aura buffs a structure inside its radius", () => {
    fail(
      "a validator deciding this point",
      "the suite for `abilities.aura-buffs-in-radius` has not been written yet",
    );
  });
});
