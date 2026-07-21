// Automated validation for the Surge sub-item `core-boss`.
//
// The Core boss carries a huge HP pool and, if it leaks, costs five lives
// (specs/surge.md). We spawn a real Core, read its base HP (1600 at wave 1), and let
// it breach an exhaust — lives drop by five.

import { newGame, spawn, unit } from "../_helpers.mjs";

export default function item() {
  let coreId;
  let c;
  let r;
  let lives;

  return {
    id: "surge.core-boss",

    // 20 lives, so a five-life breach is visible as an exact drop rather than ending
    // the run.
    async arrange(api) {
      await newGame(api, "containment", "medium", 100000);
      await api.call("setLives", 20);
      coreId = await spawn(api, "core", "left");
      c = await unit(api, coreId);
    },

    // A Core is the slowest unit on the floor (30 px/s), so it needs the longest cap
    // to cross. 2700 ticks = the old 45s cap, polled every 15 ticks (the old 0.25s
    // chunk).
    async act(api) {
      r = await api.until((s) => s.lives < 20, { max: 2700, poll: 15 });
      lives = (await api.snapshot()).lives;
    },

    async assert(api, check) {
      check.expectClose("a Core's base HP is 1600", c.maxHp, 1600, 1);
      check.expectOk("the Core breached", r.hit);
      check.expectEq("a Core leak costs five lives", lives, 15);
    },
  };
}
