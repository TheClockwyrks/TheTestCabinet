// Arc Foundry — `targeting.nearest`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `targeting/nearest.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. A structure set to nearest fires at the in-range unit at
// the shortest straight-line distance from its centre, whatever their
// positions along the chain.
//
// HOW IT IS DECIDED. Park frozen units at known distances, set nearest, fire
// once, and read the projectile's target. The evidence it hands back is
// `nearest` (replay): the nearest target selected.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("targeting.nearest", () => {
  it("nearest selects the closest unit", () => {
    fail(
      "a validator deciding this point",
      "the suite for `targeting.nearest` has not been written yet",
    );
  });
});
