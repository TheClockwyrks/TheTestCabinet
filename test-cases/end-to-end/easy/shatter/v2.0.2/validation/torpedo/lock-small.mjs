// Automated validation (Warhead) for the Homing-torpedo item `lock-small`: the torpedo locks
// onto a Small rock. The target is placed inside the forward cone but off the launch centerline
// (~12.5 deg, ~71 px off the straight-ahead line — far more than a Small's 14 px radius plus the
// torpedo's 6), so only a homing torpedo reaches it: a hit proves it acquired and curved onto
// the Small.
//
// The ship's pose, the off-axis Small and the readied charge are the preconditions (`arrange`);
// the launch and the homing kill are the behavior (`act`). The sweep runs to 2 s x 120 Hz = 240
// ticks and polls a single tick so the field is read the instant the torpedo is spent.

import { newGame, poseShip, TICK } from "../_helpers.mjs";

export default function item() {
  let snap;

  return {
    id: "torpedo.lock-small",

    async arrange(api) {
      await newGame(api);
      await api.call("clearRocks");
      await api.call("removeSaucer");
      await poseShip(api, { x: 150, y: 120, vx: 0, vy: 0, angle: 0 }); // facing +x, clear of the star
      await api.call("addRock", "small", { x: 483, y: 191, vx: 0, vy: 0 }); // off-centerline, only reachable by homing
      await api.call("setTorpedoReady", true);
    },

    async act(api) {
      await api.call("press", "KeyF");
      ({ snap } = await api.until((s) => s.torpedoes.length === 0, {
        max: 240,
        poll: TICK,
      }));
    },

    async assert(api, check) {
      check.expectEq("the torpedo is spent on the hit", snap.torpedoes.length, 0);
      check.expectEq(
        "the torpedo locks onto the off-axis Small and destroys it outright",
        snap.rocks.filter((r) => r.size === "small").length,
        0,
      );
    },
  };
}
