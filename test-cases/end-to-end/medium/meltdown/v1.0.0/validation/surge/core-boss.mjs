// Automated validation for the Surge sub-item `core-boss`.
//
// The Core boss carries a huge HP pool and, if it leaks, costs five lives
// (specs/surge.md). We spawn a real Core, read its base HP (1600 at wave 1), and let
// it breach an exhaust — lives drop by five.
//
// A Core is the slowest unit in the game (30 px/s), so its crossing is over half a
// minute. None of that is the claim, so `arrange` skips it unfilmed and `act` opens
// with the Core on final approach; its HP is read at the spawn, before any of it.

import { newGame, spawn, unit, skipToApproach, actTail } from "../_helpers.mjs";

export default function item() {
  let coreId;
  let c;
  let r;
  let lives;

  return {
    id: "surge.core-boss",

    // A Core is the slowest unit in the game (30 px/s); its final approach alone is
    // about four seconds.
    clipMs: 7500,

    // 20 lives, so a five-life breach is visible as an exact drop rather than ending
    // the run.
    async arrange(api) {
      await newGame(api, "containment", "medium", 100000);
      await api.call("setLives", 20);
      coreId = await spawn(api, "core", "left");
      c = await unit(api, coreId);
      await skipToApproach(api, coreId);
    },

    // 480 ticks = 8s: at 30 px/s the last 120 px are about four seconds.
    async act(api) {
      r = await api.until((s) => s.lives < 20, { max: 480, poll: 6 });
      lives = (await api.snapshot()).lives;
      await actTail(api, 90); // a beat on the life count sitting at 15
    },

    async assert(api, check) {
      check.expectClose("a Core's base HP is 1600", c.maxHp, 1600, 1);
      check.expectOk("the Core breached", r.hit);
      check.expectEq("a Core leak costs five lives", lives, 15);
    },
  };
}
