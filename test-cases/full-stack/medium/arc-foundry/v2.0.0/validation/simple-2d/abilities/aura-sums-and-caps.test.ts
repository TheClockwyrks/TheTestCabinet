// Arc Foundry — `abilities.aura-sums-and-caps`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `abilities/aura-sums-and-caps.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. Bonuses from several Regulators covering one structure add
// together, and the summed bonus is capped at AURA_CAP (1.0), so a structure
// under enough Regulators reports exactly twice its base damage and no more.
//
// HOW IT IS DECIDED. Stand two Regulators over one structure, read its damage,
// then stand enough to exceed the cap and read it again. The evidence it hands
// back is `cap` (image): the capped damage under many auras.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("abilities.aura-sums-and-caps", () => {
  it("Aura bonuses sum and cap at AURA_CAP", () => {
    fail(
      "a validator deciding this point",
      "the suite for `abilities.aura-sums-and-caps` has not been written yet",
    );
  });
});
