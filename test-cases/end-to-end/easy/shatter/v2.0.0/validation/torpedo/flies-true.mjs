// Automated validation (Warhead) for the Torpedo item `flies-true`: being self-propelled, a
// torpedo flies true through the gravity well instead of curving like a bullet. With no
// targets on the field, a torpedo is launched horizontally to pass just above the star; after
// stepping it must hold its heading and its height — it neither homes nor is bent by gravity.
//
// The cleared field, the ship's pose and the readied charge are the preconditions (`arrange`);
// the launch and the flight past the star are the behavior (`act`), so the clip is the torpedo
// holding its line where a bullet would visibly bend. 0.8 s x 120 Hz = 96 ticks.

import { newGame, poseShip } from "../_helpers.mjs";

export default function item() {
  // The torpedo as it launched, and after it has crossed the well.
  let launch;
  let t;

  return {
    id: "torpedo.flies-true",

    async arrange(api) {
      await newGame(api);
      await api.call("clearRocks");
      await api.call("removeSaucer");
      await poseShip(api, { x: 200, y: 260, vx: 0, vy: 0, angle: 0 }); // passes above the core
      await api.call("setTorpedoReady", true);
    },

    async act(api) {
      await api.call("press", "KeyF");
      launch = (await api.snapshot()).torpedoes[0];

      await api.advance(96); // fly it past the star
      t = (await api.snapshot()).torpedoes[0];
    },

    async assert(api, check) {
      check.expectClose(
        "the torpedo launches straight (heading 0)",
        launch.heading,
        0,
        1e-6,
      );
      check.expectOk(
        "the torpedo is still in flight past the star",
        Boolean(t),
      );
      check.expectClose(
        "its heading is unchanged — no homing, no curve",
        t.heading,
        0,
        0.02,
      );
      check.expectClose(
        "gravity does not bend it (no vertical velocity)",
        t.vy,
        0,
        5,
      );
      check.expectClose(
        "it holds its height, flying true through the well",
        t.y,
        260,
        5,
      );
    },
  };
}
