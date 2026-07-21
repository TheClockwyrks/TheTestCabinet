// Automated validation for the Gravity item `rock-curves`: a rock travels on a curved
// path because the star pulls it. A real rock is placed above and to the left of the star
// drifting purely horizontally; after the real sim steps, gravity must have given it
// velocity toward the star (downward), so it curves rather than moving in a straight line.
//
// Placing the rock is the precondition (`arrange`); the drift past the well is the behavior
// (`act`), so the clip is the curve itself. 0.5 s x 120 Hz = 60 ticks.

import { newGame } from "../_helpers.mjs";

export default function item() {
  // The rock as it was posed, and after it has drifted past the well.
  let before;
  let after;

  return {
    id: "gravity.rock-curves",

    async arrange(api) {
      await newGame(api);
      await api.call("addRock", "small", { x: 440, y: 300, vx: 200, vy: 0 });
      before = (await api.snapshot()).rocks[0];
    },

    async act(api) {
      await api.advance(60);
      after = (await api.snapshot()).rocks[0];
    },

    async assert(api, check) {
      check.expectClose(
        "the rock starts drifting with no vertical velocity",
        before.vy,
        0,
        1e-6,
      );
      check.expectOk("the rock is still on the field", Boolean(after));
      check.expectGt(
        "gravity curved the rock's path toward the star (gained downward velocity)",
        after.vy,
        15,
      );
    },
  };
}
