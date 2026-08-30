// Arc Foundry — `firing.tallies`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `firing/tallies.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. A firing structure's reported kills and damageDealt are the
// running totals of what it dealt: after driving a counted number of kills its
// damageDealt equals the health it removed and its kills equals the units it
// destroyed.
//
// HOW IT IS DECIDED. Drive a counted set of kills with one structure and hold
// both tallies against the health removed. The evidence it hands back is
// `tally` (replay): the structure and its tallies.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("firing.tallies", () => {
  it("A structure tallies its kills and its damage", () => {
    fail(
      "a validator deciding this point",
      "the suite for `firing.tallies` has not been written yet",
    );
  });
});
