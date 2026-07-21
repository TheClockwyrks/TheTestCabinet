// Automated validation for the Hunter item `catches`.
//
// A bear that reaches the critter catches it — a life is lost. A bear is placed on
// the tile beside a stationary critter; the real pursuit glides into it and the
// catch resolves, which the snapshot reads back. See validation/_helpers.mjs.

import { startCrossing } from "../_helpers.mjs";

export default function item() {
  // The sweep that waited for the catch.
  let r;

  return {
    id: "hunter.catches",

    // Pose the catch: the critter parked on the solid median, a bear on the tile
    // right beside it, and a full three lives so the loss reads as a decrement.
    async arrange(api) {
      await startCrossing(api);
      await api.call("setLives", 3);
      await api.call("placeCritter", 20, 10); // median, solid
      await api.call("setBear", 0, { col: 21, row: 10 }); // adjacent
    },

    // The bear closing the last tile and lunging — the real pursuit resolving into
    // the catch, which is both what is checked and what the clip shows. (The old
    // clip started the bear three tiles out; the assertions drove the adjacent bear,
    // so that is what is filmed.)
    async act(api) {
      r = await api.until((s) => s.phase === "dying", { max: 120 }); // 1 s
    },

    async assert(api, check) {
      check.expectOk("an adjacent bear catches a stationary critter", r.hit);
      check.expectEq("the phase is dying after a catch", r.snap.phase, "dying");
      check.expectEq("a life is lost to the bear", r.snap.lives, 2);
    },
  };
}
