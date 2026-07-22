// Automated validation (Warhead) for the Homing-torpedo item `wrap`: the torpedo wraps at the
// field edges like every body (specs/mode-warhead.md). With no targets on the field, a torpedo
// is launched toward the right edge along the empty top; it must cross the edge and re-enter at
// the left carrying its speed.
//
// The cleared field, the ship's pose near the right edge and the readied charge are the
// preconditions (`arrange`); the launch and the crossing are the behavior (`act`), so the clip
// is the torpedo streaking off one edge and back on the other. `actWrapAcross` ticks one at a
// time because the wrap is a discontinuity between two consecutive samples — a coarse poll would
// step over the seam.

import { newGame, poseShip, actWrapAcross, TORPEDO_SPEED } from "../_helpers.mjs";

export default function item() {
  // The torpedo just before and just after the wrap.
  let result;

  return {
    id: "torpedo.wrap",

    async arrange(api) {
      await newGame(api);
      await api.call("clearRocks");
      await api.call("removeSaucer");
      await poseShip(api, { x: 1150, y: 150, vx: 0, vy: 0, angle: 0 }); // near the right edge, facing +x, clear of the star
      await api.call("setTorpedoReady", true);
    },

    async act(api) {
      await api.call("press", "KeyF");
      result = await actWrapAcross(api, (s) => s.torpedoes[0], { maxTicks: 200 });
    },

    async assert(api, check) {
      check.expectOk("the torpedo wraps across the right edge", result.wrapped);
      check.expectClose(
        "it re-enters carrying its speed (~420 px/s along +x)",
        result.after.vx,
        TORPEDO_SPEED,
        40,
      );
      check.expectClose(
        "it keeps its height across the seam",
        result.after.y,
        150,
        8,
      );
    },
  };
}
