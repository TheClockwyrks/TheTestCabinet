// Automated validation (Warhead) for the Torpedo item `flies-true`: being self-propelled, a
// torpedo flies true through the gravity well instead of curving like a bullet. With no
// targets on the field, a torpedo is launched horizontally to pass just above the star; after
// stepping it must hold its heading and its height — it neither homes nor is bent by gravity.
//
// The cleared field, the ship's pose and the readied charge are the preconditions (`arrange`);
// the launch and the flight past the star are the behavior (`act`), so the clip is the torpedo
// holding its line where a bullet would visibly bend. 0.8 s x 120 Hz = 96 ticks.
//
// Headings are compared with `angleDelta`, never by subtracting or by taking `Math.abs` of a
// raw angle. A heading names a direction and the case fixes no range for it, so a build
// keeping headings in [0, 2pi) reports a torpedo drifting a hair below straight as ~6.28
// rather than ~-0.003 — the same flight path, a whole turn of apparent error. The shortest-arc
// reading is the same on every convention.

import {
  newGame,
  poseShip,
  angleDelta,
  arrangeBystanderRock,
} from "../_helpers.mjs";

// How far the torpedo is followed. At 420 px/s, 240 ticks carries it 840 px — from the
// ship at x = 200, past the star's column at 640, and out to the far side of the field,
// well inside its 3.5 s lifetime. The closest approach to the star is at 120 ticks, so the
// reading at the end is taken after the well has had its whole chance to bend the flight.
const FLIGHT = 240; // 2 s

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
      // Keeps the field occupied for the whole flight, so no wave arrives into it. The
      // parking spot is well outside the torpedo's forward cone from every point on its
      // lane, so it is scenery rather than a target.
      await arrangeBystanderRock(api);
      await poseShip(api, { x: 200, y: 260, vx: 0, vy: 0, angle: 0 }); // passes above the core
      await api.call("setTorpedoReady", true);
    },

    async act(api) {
      await api.call("press", "KeyF");
      launch = (await api.snapshot()).torpedoes[0];

      await api.advance(FLIGHT); // fly it past the star — see FLIGHT
      t = (await api.snapshot()).torpedoes[0];
    },

    async assert(api, check) {
      // Both readings are dereferenced below, so these are hard: a missing torpedo stops
      // the item with that recorded as the failure, rather than throwing out of it.
      check.assertOk("pressing F launches a torpedo", Boolean(launch));
      check.expectClose(
        "the torpedo launches straight (heading 0)",
        angleDelta(launch.heading, 0),
        0,
        1e-6,
      );
      check.assertOk(
        "the torpedo is still in flight past the star",
        Boolean(t),
      );
      check.expectClose(
        "its heading is unchanged — no homing, no curve",
        angleDelta(t.heading, 0),
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
