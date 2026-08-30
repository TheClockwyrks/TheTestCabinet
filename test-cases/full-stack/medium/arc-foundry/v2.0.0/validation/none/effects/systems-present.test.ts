// Arc Foundry — `effects.systems-present`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `effects/systems-present.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. assets/fx/<effect>.json exists for all twelve named effects
// — build, combine, bolt, chain, spray, ring, impact, death, leak, slow, burn
// and aura — and each parses as a particle system carrying at least one
// emitter.
//
// HOW IT IS DECIDED. Read the twelve files and parse each against the particle
// runtime's system shape. The evidence it hands back is `fx` (image): the
// produced effects playing on the yard.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("effects.systems-present", () => {
  it("The twelve systems are produced and parse", () => {
    fail(
      "a validator deciding this point",
      "the suite for `effects.systems-present` has not been written yet",
    );
  });
});
