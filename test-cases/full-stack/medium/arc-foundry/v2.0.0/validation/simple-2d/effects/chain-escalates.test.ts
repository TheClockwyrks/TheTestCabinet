// Arc Foundry — `effects.chain-escalates`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `effects/chain-escalates.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. The pixels drawn between the units a Coil's chain strikes
// differ between a Tesla-Prime Coil and a Scrap Coil in the identical
// scenario.
//
// HOW IT IS DECIDED. Fire the same chain from a Scrap and a Tesla-Prime Coil
// and compare the pixels between the struck units. The evidence it hands back
// is `chains` (replay): a Scrap chain and a Tesla-Prime chain.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("effects.chain-escalates", () => {
  it("A Tesla-Prime chain is not a Scrap chain", () => {
    fail(
      "a validator deciding this point",
      "the suite for `effects.chain-escalates` has not been written yet",
    );
  });
});
