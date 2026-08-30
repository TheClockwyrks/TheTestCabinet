// Arc Foundry — `effects.chain-forks`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `effects/chain-forks.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. Particles are drawn between each pair of units a Coil's
// chain strikes on the frame the chain resolves, and none are drawn there
// before it.
//
// HOW IT IS DECIDED. Park a line of frozen units, fire one Coil shot, and
// sample between each struck pair either side of the hit. The evidence it
// hands back is `chain` (replay): the forked chain between struck units.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("effects.chain-forks", () => {
  it("A Coil's chain forks between the units it strikes", () => {
    fail(
      "a validator deciding this point",
      "the suite for `effects.chain-forks` has not been written yet",
    );
  });
});
