// Automated validation (Warhead) for the Homing-torpedo item `lock-saucer`: the torpedo locks
// onto the saucer. The saucer is placed inside the forward cone but off the launch centerline
// (~12.5 deg, ~71 px off the straight-ahead line — more than the saucer's 18 px radius plus the
// torpedo's 6), so only a homing torpedo reaches it. Being far faster than the saucer, the
// torpedo runs it down: destroying it proves it locked on rather than flew straight.
//
// The ship's pose, the off-axis saucer and the readied charge are the preconditions (`arrange`);
// the launch and the homing kill are the behavior (`act`). The sweep runs to 2.5 s x 120 Hz =
// 300 ticks and polls a single tick so the field is read the instant the saucer is destroyed.

import { newGame, poseShip, SAUCER_SCORE, TICK } from "../_helpers.mjs";

export default function item() {
  let result;

  return {
    id: "torpedo.lock-saucer",

    async arrange(api) {
      await newGame(api);
      await api.call("clearRocks");
      await api.call("setScore", 0);
      await poseShip(api, { x: 150, y: 120, vx: 0, vy: 0, angle: 0 }); // facing +x, clear of the star
      await api.call("spawnSaucer");
      await api.call("setSaucer", { x: 483, y: 191, vx: 0, vy: 0 }); // off-centerline, only reachable by homing
      await api.call("setTorpedoReady", true);
    },

    async act(api) {
      await api.call("press", "KeyF");
      result = await api.until((s) => s.saucer === null, {
        max: 300,
        poll: TICK,
      });
    },

    async assert(api, check) {
      check.expectEq(
        "the torpedo locks onto the off-axis saucer and destroys it",
        result.snap.saucer,
        null,
      );
      check.expectEq(
        "destroying the saucer with a torpedo scores 200",
        result.snap.score,
        SAUCER_SCORE,
      );
    },
  };
}
