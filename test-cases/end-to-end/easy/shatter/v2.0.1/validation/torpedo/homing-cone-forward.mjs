// Automated validation (Warhead) for the Torpedo item `homing-cone-forward`: the homing cone
// only looks forward, so the torpedo never doubles back on a body behind it. A rock is placed
// directly BEHIND the launch heading; after stepping, the torpedo must keep its forward
// heading and keep moving forward, never turning around to chase the rock behind.
//
// The ship's pose, the rock behind it and the readied charge are the preconditions (`arrange`);
// the launch and the flight away from the rock are the behavior (`act`), so the clip is the
// torpedo declining to turn around. 0.3 s x 120 Hz = 36 ticks.
//
// Headings are compared with `angleDelta`, never by subtracting or by taking `Math.abs` of a
// raw angle. A heading names a direction and the case fixes no range for it, so a build
// keeping headings in [0, 2pi) reports a torpedo drifting a hair below straight as ~6.28
// rather than ~-0.003 — the same flight path, a whole turn of apparent error. The shortest-arc
// reading is the same on every convention.

import { newGame, poseShip, angleDelta } from "../_helpers.mjs";

export default function item() {
  // The torpedo as it launched, and once it has had time to turn (and not).
  let launch;
  let t;

  return {
    id: "torpedo.homing-cone-forward",

    // Pose the ship clear of the star (the torpedo launches on its facing, and a body
    // launched into the star core would be absorbed at once). Face +x with a rock placed
    // directly behind the launch heading.
    async arrange(api) {
      await newGame(api);
      await api.call("clearRocks");
      await poseShip(api, { x: 300, y: 360, vx: 0, vy: 0, angle: 0 }); // facing +x
      await api.call("addRock", "large", { x: 100, y: 360, vx: 0, vy: 0 }); // directly behind
      await api.call("setTorpedoReady", true);
    },

    async act(api) {
      await api.call("press", "KeyF");
      launch = (await api.snapshot()).torpedoes[0];

      await api.advance(36);
      t = (await api.snapshot()).torpedoes[0];
    },

    async assert(api, check) {
      check.expectOk("the torpedo is still in flight", Boolean(t));
      check.expectLt(
        "it does not turn around toward the rock behind it",
        Math.abs(angleDelta(t.heading, 0)),
        0.1,
      );
      check.expectGt(
        "it keeps flying forward, away from the rock behind",
        t.x,
        launch.x,
      );
    },
  };
}
