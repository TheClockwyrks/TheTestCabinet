// Arc Foundry — `effects.systems-distinct`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `effects/systems-distinct.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. No two of the twelve system documents are the same authored
// system: each pair differs in its emitters, its forces or its per-particle
// curves rather than being one file committed twelve times.
//
// HOW IT IS DECIDED. Parse the twelve systems and compare them pairwise. The
// evidence it hands back is `fx` (image): the twelve effects side by side.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("effects.systems-distinct", () => {
  it("The twelve systems are twelve different effects", () => {
    fail(
      "a validator deciding this point",
      "the suite for `effects.systems-distinct` has not been written yet",
    );
  });
});
