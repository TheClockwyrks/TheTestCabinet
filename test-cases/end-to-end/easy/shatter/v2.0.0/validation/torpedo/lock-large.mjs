// Automated validation (Warhead) for the Homing-torpedo item `lock-large`: the torpedo locks
// onto a Large rock. The target is placed inside the forward cone but off the launch
// centerline (~12.5 deg, its center ~71 px off the straight-ahead line — more than a Large's
// 46 px radius plus the torpedo's 6), so a torpedo that did not home would sail past it: a hit
// proves the torpedo acquired and curved onto the Large.
//
// The ship's pose, the off-axis Large and the readied charge are the preconditions (`arrange`);
// the launch and the homing kill are the behavior (`act`). The sweep runs to 2 s x 120 Hz = 240
// ticks and polls a single tick so the field is read the instant the torpedo is spent.

import { newGame, poseShip, TICK } from "../_helpers.mjs";

export default function item() {
  let snap;

  return {
    id: "torpedo.lock-large",

    async arrange(api) {
      await newGame(api);
      await api.call("clearRocks");
      await api.call("removeSaucer");
      await poseShip(api, { x: 150, y: 120, vx: 0, vy: 0, angle: 0 }); // facing +x, clear of the star
      await api.call("addRock", "large", { x: 483, y: 191, vx: 0, vy: 0 }); // off-centerline, only reachable by homing
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
        "the torpedo locks onto the off-axis Large and destroys it",
        snap.rocks.filter((r) => r.size === "large").length,
        0,
      );
    },
  };
}
