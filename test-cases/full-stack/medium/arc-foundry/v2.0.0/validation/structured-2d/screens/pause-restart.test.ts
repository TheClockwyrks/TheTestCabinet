// Arc Foundry — `screens.pause-restart`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `screens/pause-restart.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. Taking RESTART begins a fresh run on the same map at the
// same difficulty: the yard is empty, Charge is back to START_CHARGE, Grid
// Integrity to START_INTEGRITY, refinement 0 and the wave counter 0.
//
// HOW IT IS DECIDED. Drive a run, restart it from the pause menu, and read the
// opening state and the map and difficulty. The evidence it hands back is
// `restart` (image): the fresh run a restart began.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("screens.pause-restart", () => {
  it("RESTART begins a fresh run on the same map and difficulty", () => {
    fail(
      "a validator deciding this point",
      "the suite for `screens.pause-restart` has not been written yet",
    );
  });
});
