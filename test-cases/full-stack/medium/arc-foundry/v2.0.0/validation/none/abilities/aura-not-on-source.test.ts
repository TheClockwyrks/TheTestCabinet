// Arc Foundry — `abilities.aura-not-on-source`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `abilities/aura-not-on-source.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. A Regulator standing inside another Regulator's radius
// still reports zero damage, and a combination tower carrying an aura reports
// its own damage without that aura's bonus while a second tower beside it is
// buffed.
//
// HOW IT IS DECIDED. Stand two aura sources within reach of each other and
// read each one's own damage. The evidence it hands back is `source` (image):
// the aura source, unaffected by itself.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("abilities.aura-not-on-source", () => {
  it("An aura never buffs its own source", () => {
    fail(
      "a validator deciding this point",
      "the suite for `abilities.aura-not-on-source` has not been written yet",
    );
  });
});
