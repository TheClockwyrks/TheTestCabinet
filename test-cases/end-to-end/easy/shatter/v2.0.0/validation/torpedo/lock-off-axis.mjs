// Automated validation (Warhead) for the Homing-torpedo item `lock-off-axis`: the torpedo locks
// onto a target near the edge of its forward cone. A rock is placed about 14 degrees off the
// launch centerline — inside the +/- 15 degree acquisition cone (specs/mode-warhead.md), but far
// enough off the straight line that a torpedo that did NOT home would sail past it. The torpedo
// must acquire it and curve on to destroy it, so a hit proves it locked on rather than flew
// straight.
//
// The ship's pose, the off-axis rock and the readied charge are the preconditions (`arrange`);
// the launch and the homing turn onto the target are the behavior (`act`), so the clip is the
// torpedo bending off its launch heading onto the rock. The sweep runs to 2 s x 120 Hz = 240
// ticks and polls a single tick so the field is read the instant the torpedo is spent.
//
// Geometry: nose ~(164, 120); rock at (510, 206) is bearing ~14 deg from the nose, and its
// center sits ~86 px off the straight-ahead line (y = 120) — far more than a Large's 46 px
// radius, so only a homing torpedo reaches it.

import { newGame, poseShip, TICK } from "../_helpers.mjs";

export default function item() {
  // The torpedo just after launch (to confirm it left straight) and the field once it is spent.
  let launch;
  let snap;

  return {
    id: "torpedo.lock-off-axis",

    async arrange(api) {
      await newGame(api);
      await api.call("clearRocks");
      await api.call("removeSaucer");
      await poseShip(api, { x: 150, y: 120, vx: 0, vy: 0, angle: 0 }); // facing +x
      await api.call("addRock", "large", { x: 510, y: 206, vx: 0, vy: 0 }); // ~14 deg off, off the straight line
      await api.call("setTorpedoReady", true);
    },

    async act(api) {
      await api.call("press", "KeyF");
      launch = (await api.snapshot()).torpedoes[0];
      ({ snap } = await api.until((s) => s.torpedoes.length === 0, {
        max: 240,
        poll: TICK,
      }));
    },

    async assert(api, check) {
      check.expectClose(
        "the torpedo leaves straight on the ship's facing",
        launch.heading,
        0,
        1e-6,
      );
      check.expectEq("the torpedo is spent on the hit", snap.torpedoes.length, 0);
      check.expectEq(
        "the torpedo locks onto the off-axis rock and destroys it",
        snap.rocks.filter((r) => r.size === "large").length,
        0,
      );
    },
  };
}
