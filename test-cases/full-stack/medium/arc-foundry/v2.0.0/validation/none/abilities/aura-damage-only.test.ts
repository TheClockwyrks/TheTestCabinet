// Arc Foundry — `abilities.aura-damage-only`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `abilities/aura-damage-only.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. A buffed structure's reported range, fire rate and every
// ability parameter are identical to the same structure with no Regulator
// beside it, so an aura touches damage and nothing else.
//
// HOW IT IS DECIDED. Read every reported stat of a structure with and without
// a Regulator beside it. The evidence it hands back is `damage` (image): the
// buffed structure with untouched reach.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("abilities.aura-damage-only", () => {
  it("An aura changes damage alone", () => {
    fail(
      "a validator deciding this point",
      "the suite for `abilities.aura-damage-only` has not been written yet",
    );
  });
});
