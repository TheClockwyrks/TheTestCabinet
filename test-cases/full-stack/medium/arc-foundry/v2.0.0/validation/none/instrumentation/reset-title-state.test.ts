// Arc Foundry — `instrumentation.reset-title-state`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `instrumentation/reset-title-state.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. After a run has been driven — structures standing, Charge
// spent, refinement bought, a wave under way — reset({seed: 7}) restores the
// title screen with menuIndex 0, the map back to substation and the difficulty
// to medium, the yard emptied, the selection and combine set cleared, nothing
// held, the press unarmed, Charge at START_CHARGE (10), Grid Integrity at
// START_INTEGRITY (20), refinement 0, wave 0, stampsLeft at STAMPS_PER_LEVEL
// (5), the Maze Rating 0, speed 1, both overlays closed, the pause released
// and simTime 0.
//
// HOW IT IS DECIDED. Dirty every field first, then reset and hold the state
// against the full title-state list in specs/instrumentation.md. The evidence
// it hands back is `title` (image): the title state after reset.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("instrumentation.reset-title-state", () => {
  it("reset returns the game to its title-screen values", () => {
    fail(
      "a validator deciding this point",
      "the suite for `instrumentation.reset-title-state` has not been written yet",
    );
  });
});
