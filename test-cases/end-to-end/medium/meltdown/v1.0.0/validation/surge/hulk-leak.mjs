// Automated validation for the Surge sub-item `hulk-leak`.
//
// A Hulk leak costs two lives, more than a light unit (specs/surge.md). We let a real
// Hulk walk out an exhaust and confirm lives drop by exactly two.

import { newGame, spawn } from "../_helpers.mjs";

export default function item() {
  let r;
  let lives;

  return {
    id: "surge.hulk-leak",

    async arrange(api) {
      await newGame(api, "containment", "medium", 100000);
      await api.call("setLives", 10);
      await spawn(api, "hulk", "left");
    },

    // A Hulk is slow (38 px/s), so it needs a long cap to cross the floor. 2700 ticks
    // = the old 45s cap, polled every 15 ticks (the old 0.25s chunk).
    async act(api) {
      r = await api.until((s) => s.lives < 10, { max: 2700, poll: 15 });
      lives = (await api.snapshot()).lives;
    },

    async assert(api, check) {
      check.expectOk("the Hulk leaked", r.hit);
      check.expectEq("a Hulk leak costs two lives", lives, 8);
    },
  };
}
