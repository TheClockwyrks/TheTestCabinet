// Arc Foundry — `load.wave-growth`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `load/wave-growth.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. Each wave's total health pool, summed over the maximum
// health of every unit it releases, is at least that of the wave before it,
// across a whole run.
//
// HOW IT IS DECIDED. Play a run's waves through, sum each wave's released
// health, and compare consecutive sums. The evidence it hands back is `growth`
// (replay): the Load's growing pool.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("load.wave-growth", () => {
  it("A wave's health pool never falls", () => {
    fail(
      "a validator deciding this point",
      "the suite for `load.wave-growth` has not been written yet",
    );
  });
});
