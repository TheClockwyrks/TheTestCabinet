// Arc Foundry — `abilities.coil-chain-ends`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `abilities/coil-chain-ends.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. A leap that finds no unit within COIL_LEAP_RANGE it has not
// already struck ends the chain: a lone unit takes the primary hit alone, and
// the game does not throw.
//
// HOW IT IS DECIDED. Park one frozen unit well clear of every other and fire
// one Coil shot. The evidence it hands back is `lone` (replay): the chain
// ending on a lone unit.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("abilities.coil-chain-ends", () => {
  it("A chain with nothing left in range ends", () => {
    fail(
      "a validator deciding this point",
      "the suite for `abilities.coil-chain-ends` has not been written yet",
    );
  });
});
