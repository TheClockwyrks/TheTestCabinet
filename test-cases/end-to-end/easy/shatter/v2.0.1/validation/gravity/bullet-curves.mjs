// Automated validation for the Gravity item `bullet-curves`: a bullet fired past the
// star is pulled toward it and visibly curves. A real bullet is placed above and to the
// left of the star moving purely horizontally (no vertical velocity), so it flies across
// the top of the well; after the real sim steps, gravity must have given it a clear
// velocity toward the star (downward), bending its path.
//
// Placing the bullet is the precondition (`arrange`); the flight past the well is the behavior
// (`act`), so the clip is the curve itself. 1.0 s x 120 Hz = 120 ticks.
//
// A second, rather than the 0.35 s this used to run, because 0.35 s ended the flight at the
// star's own x — the moment the bend BEGINS. The shot had turned barely 7 degrees off level by
// then, which the assertion could measure but no reviewer could see. Gravity keeps working on
// it well past the well: a full second carries the round to the right of the field having
// fallen a hundred px below the line it was launched on, which reads as a curve at a glance.
// It also stops short of the two things that would muddy the picture — the bullet's 1.5 s
// lifetime, and the wrap it would make at the right edge a few ticks later.

import { newGame } from "../_helpers.mjs";

export default function item() {
  // The bullet as it was launched, and after it has crossed the well.
  let before;
  let after;

  return {
    id: "gravity.bullet-curves",

    async arrange(api) {
      await newGame(api);
      await api.call("addBullet", { x: 440, y: 300, vx: 520, vy: 0 });
      before = (await api.snapshot()).bullets[0];
    },

    async act(api) {
      await api.advance(120); // fly it across the top of the well and out the far side
      after = (await api.snapshot()).bullets[0];
    },

    async assert(api, check) {
      check.expectClose(
        "the bullet starts with no vertical velocity",
        before.vy,
        0,
        1e-6,
      );
      check.expectOk(
        "the bullet is still in flight past the star",
        Boolean(after),
      );
      check.expectGt(
        "gravity bent the shot toward the star (gained downward velocity)",
        after.vy,
        30,
      );
    },
  };
}
