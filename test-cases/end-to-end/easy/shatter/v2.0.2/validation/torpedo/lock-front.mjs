// Automated validation (Warhead) for the Homing-torpedo item `lock-front`: the torpedo locks
// onto a target dead ahead. A rock is placed directly in front of the ship, on the launch
// centerline; the torpedo acquires it within its forward cone and destroys it.
//
// The ship's pose, the rock ahead and the readied charge are the preconditions (`arrange`); the
// launch and the impact are the behavior (`act`), so the clip is the torpedo running down the
// target in front of it. The sweep runs to 2 s x 120 Hz = 240 ticks and polls a single tick so
// the field is read the instant the torpedo is spent.

import { newGame, poseShip, TICK } from "../_helpers.mjs";

export default function item() {
  // The field the instant the torpedo was spent, read by `assert`.
  let snap;

  return {
    id: "torpedo.lock-front",

    // Pose the ship and target along the empty top of the field, clear of the central star
    // (a shot fired through it would be taken by the core on the way).
    async arrange(api) {
      await newGame(api);
      await api.call("clearRocks");
      await api.call("removeSaucer");
      await poseShip(api, { x: 150, y: 150, vx: 0, vy: 0, angle: 0 }); // facing +x
      await api.call("addRock", "large", { x: 600, y: 150, vx: 0, vy: 0 }); // directly in front, on the centerline
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
        "the torpedo destroys the rock directly in front of it",
        snap.rocks.filter((r) => r.size === "large").length,
        0,
      );
      check.expectEq(
        "the destroyed Large splits into two Medium",
        snap.rocks.filter((r) => r.size === "medium").length,
        2,
      );
    },
  };
}
