// Arc Foundry — `abilities.coil-chain-leaps`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `abilities/coil-chain-leaps.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. A Coil's projectile hits its primary target and the hit
// then leaps to the nearest unit it has not already struck within
// COIL_LEAP_RANGE (70) of the last unit struck, and again from there.
//
// HOW IT IS DECIDED. Park a line of frozen units 60 apart, fire one Coil shot,
// and read which units lost health. The evidence it hands back is `chain`
// (replay): the chain leaping down the line.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("abilities.coil-chain-leaps", () => {
  it("A Coil's hit leaps to the nearest unit it has not already struck", () => {
    fail(
      "a validator deciding this point",
      "the suite for `abilities.coil-chain-leaps` has not been written yet",
    );
  });
});
