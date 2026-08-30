// Arc Foundry — `load.health-scales-by-wave`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `load/health-scales-by-wave.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. A unit's maximum health on wave w is baseHP * baseMult * [
// (1 + k * (w - 1)) + c * (r^(w - 1) - 1) ] using the chosen difficulty's four
// constants, checked at several waves across a run.
//
// HOW IT IS DECIDED. Set several wave numbers in turn, release a Mote at each,
// and hold maxHp against the formula. The evidence it hands back is `scaling`
// (image): the Load's health deepening with the wave.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("load.health-scales-by-wave", () => {
  it("Health follows the scaling formula", () => {
    fail(
      "a validator deciding this point",
      "the suite for `load.health-scales-by-wave` has not been written yet",
    );
  });
});
