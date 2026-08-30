// Arc Foundry — `abilities.coil-chain-falloff`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `abilities/coil-chain-falloff.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. Each leap deals COIL_FALLOFF (0.7) times the previous hit's
// damage, so a Scrap Coil's 5 lands 5 on the primary, 3.5 on the first leap
// and 2.45 on the second.
//
// HOW IT IS DECIDED. Park a line of frozen units, fire one shot, and hold each
// unit's health loss against the falloff. The evidence it hands back is
// `falloff` (replay): the chain's damage falling off per leap.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("abilities.coil-chain-falloff", () => {
  it("Each leap deals COIL_FALLOFF of the last hit", () => {
    fail(
      "a validator deciding this point",
      "the suite for `abilities.coil-chain-falloff` has not been written yet",
    );
  });
});
