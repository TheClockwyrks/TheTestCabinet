// Arc Foundry — `abilities.aura-not-outside`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `abilities/aura-not-outside.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. A firing structure whose centre lies beyond the Regulator's
// aura radius reports its damage without the aura's bonus, so the radius is a
// real bound rather than a yard-wide buff.
//
// HOW IT IS DECIDED. Stand a structure just beyond the reported radius and
// read its damage back. The evidence it hands back is `outside` (image): the
// structure beyond the aura, unaffected.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("abilities.aura-not-outside", () => {
  it("A structure outside the radius takes no bonus", () => {
    fail(
      "a validator deciding this point",
      "the suite for `abilities.aura-not-outside` has not been written yet",
    );
  });
});
