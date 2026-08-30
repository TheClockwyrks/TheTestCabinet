// Arc Foundry — `status-bar.status-controls-reported`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `status-bar/status-controls-reported.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. statusControls returns the combos, damage, speed, pause and
// mute controls in the order they are drawn, each with a rectangle on the
// stage, and each state reads the value the control is on: true while the
// overlay is open, the live multiplier for speed, and the pause and mute bits.
//
// HOW IT IS DECIDED. Toggle each control in turn and hold the reported state
// against the snapshot. The evidence it hands back is `controls` (image): the
// status bar's five controls.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("status-bar.status-controls-reported", () => {
  it("statusControls reports the five controls and their states", () => {
    fail(
      "a validator deciding this point",
      "the suite for `status-bar.status-controls-reported` has not been written yet",
    );
  });
});
