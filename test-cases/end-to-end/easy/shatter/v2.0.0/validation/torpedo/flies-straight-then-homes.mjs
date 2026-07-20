// Automated validation (Warhead) for the Torpedo item `flies-straight-then-homes`: the
// torpedo leaves straight on the ship's facing, then homes onto a target within its forward
// cone. A rock is placed ahead and off-axis (but inside the cone); the torpedo launches on
// the ship's heading (0) and, after stepping, must have turned toward the rock.
//
// The ship's pose, the off-axis rock and the readied charge are the preconditions (`arrange`);
// the launch and the turn onto the target are the behavior (`act`), so the clip is the torpedo
// leaving straight and then bending onto the rock. 0.3 s x 120 Hz = 36 ticks.

import { newGame, poseShip } from "../_helpers.mjs";

export default function item() {
  // The torpedo as it launched, and once it has had time to home.
  let launch;
  let homing;

  return {
    id: "torpedo.flies-straight-then-homes",

    async arrange(api) {
      await newGame(api);
      await api.call("clearRocks");
      await poseShip(api, { x: 220, y: 360, vx: 0, vy: 0, angle: 0 });
      await api.call("addRock", "large", { x: 700, y: 450, vx: 0, vy: 0 }); // ahead, off-axis, inside the cone
      await api.call("setTorpedoReady", true);
    },

    async act(api) {
      await api.call("press", "KeyF");
      launch = (await api.snapshot()).torpedoes[0];

      await api.advance(36);
      homing = (await api.snapshot()).torpedoes[0];
    },

    async assert(api, check) {
      check.expectClose(
        "the torpedo leaves straight on the ship's facing",
        launch.heading,
        0,
        1e-6,
      );
      check.expectOk("the torpedo is still in flight", Boolean(homing));
      check.expectGt(
        "the torpedo homes, turning toward the rock below its heading",
        homing.heading,
        0.1,
      );
    },
  };
}
