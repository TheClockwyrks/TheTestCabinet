// Arc Foundry — `combos.stat-blocks`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `combos/stat-blocks.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. Every one of the twelve combination towers reports the
// range, the fire rate, the damage and the abilities its row of COMBOS fixes,
// scaled by its level, so a Rupture Node reads a splash of 60 and a burn of
// 0.5 over 2.0 seconds and an Aurora Lance reads a reach of 190 and a slow of
// 0.4 over 1.8.
//
// HOW IT IS DECIDED. Stand each of the twelve towers at level 3 and hold every
// reported stat and ability parameter against its row. The evidence it hands
// back is `twelve` (image): the twelve towers standing on the yard.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("combos.stat-blocks", () => {
  it("Each of the twelve towers carries its reference block", () => {
    fail(
      "a validator deciding this point",
      "the suite for `combos.stat-blocks` has not been written yet",
    );
  });
});
