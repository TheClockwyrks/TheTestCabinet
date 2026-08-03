// Automated validation for the Gravity item `rock-curves`: a rock travels on a curved
// path because the star pulls it. A real rock is placed above and to the left of the star
// drifting purely horizontally; after the real sim steps, gravity must have given it
// velocity toward the star (downward), so it curves rather than moving in a straight line.
//
// Placing the rock is the precondition (`arrange`); the drift past the well is the behavior
// (`act`), so the clip is the curve itself. 1.5 s x 120 Hz = 180 ticks.
//
// The rock is posed to ROUND the well rather than fall into it, which is why this scenario is
// aimed higher and faster than the bare "drifting horizontally past the star" it started as.
// A rock lobbed at the star on a shallow line does curve — and then reaches the core, where
// the star takes it and slings a replacement in from an edge (`specs/hazards.md`). That
// happens about three quarters of a second in, so the flight could not simply be lengthened:
// past that point the clip stops showing a curving rock and starts showing a recycle, which is
// `star-core/rock-recycled`'s subject, not this item's. Starting at (380, 250) with 260 px/s
// gives the pass enough clearance to survive the encounter, and a second and a half then shows
// the whole shape of it — a rock that comes in level, is bent hard as it crosses the well, and
// leaves on a visibly new heading. The bend is not done until about 1.3 s in (the rock is still
// gaining downward speed through it), which is why the clip runs past the point the assertion
// could have been decided; it ends with the rock well inside the field, before the bottom edge
// it would wrap at another second later.

import { newGame } from "../_helpers.mjs";

export default function item() {
  // The rock as it was posed, and after it has drifted past the well.
  let before;
  let after;

  return {
    id: "gravity.rock-curves",

    async arrange(api) {
      await newGame(api);
      await api.call("addRock", "small", { x: 380, y: 250, vx: 260, vy: 0 });
      before = (await api.snapshot()).rocks[0];
    },

    async act(api) {
      await api.advance(180); // drift it across the well and out the far side
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
