// Automated validation for the Controls sub-item `rotate`.
//
// R rotates the held preview 90 degrees before placing (specs/controls.md). We arm a
// tower, then press R and read the held rotation advance.

import { newGame, press, actTail } from "../_helpers.mjs";

export default function item() {
  let before;
  let after;

  return {
    id: "controls.rotate",

    async arrange(api) {
      await newGame(api, "containment", "medium", 100000);
    },

    // Arm and rotate. The clip shows the held preview swinging a quarter turn, which
    // is the whole of what this item checks.
    async act(api) {
      await press(api, "Digit1"); // arm the Arc
      before = (await api.snapshot()).build.rotation;
      await press(api, "KeyR");
      after = (await api.snapshot()).build.rotation;

      // A key press and the state it leaves behind both resolve instantly, so without
      // this the clip is a still frame of a game that never visibly does anything —
      // three seconds of the result on screen is what makes it reviewable.
      await actTail(api, 180);
    },

    async assert(api, check) {
      check.expectEq("the held tower starts un-rotated", before, 0);
      check.expectEq("R rotates the held tower a quarter turn", after, 1);
    },
  };
}
