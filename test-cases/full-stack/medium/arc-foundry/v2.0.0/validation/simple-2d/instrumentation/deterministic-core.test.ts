// Arc Foundry — `instrumentation.deterministic-core`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `instrumentation/deterministic-core.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. Covering one second of simulation time as a single frame
// and as sixty frames adds 1.0 to simTime either way and leaves a travelling
// unit at the same position within 1 logical unit, and a projectile fired
// under each covers the same distance, so the simulation reads nothing from
// the renderer and nothing from the wall clock.
//
// HOW IT IS DECIDED. Cover the same second under two step sizes and compare
// simTime and the unit and projectile positions. The evidence it hands back is
// `drive` (replay): the yard the two step sizes were compared over.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("instrumentation.deterministic-core", () => {
  it("The simulation advances on elapsed time alone", () => {
    fail(
      "a validator deciding this point",
      "the suite for `instrumentation.deterministic-core` has not been written yet",
    );
  });
});
