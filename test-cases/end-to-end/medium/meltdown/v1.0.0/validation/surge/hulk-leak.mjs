// Automated validation for the Surge sub-item `hulk-leak`.
//
// A Hulk leak costs two lives, more than a light unit (specs/surge.md). We let a real
// Hulk walk out an exhaust and confirm lives drop by exactly two.
//
// A Hulk crosses the floor at 38 px/s, so getting it to an exhaust is around 25 s of
// walking that says nothing about what the arrival costs. `arrange` skips it unfilmed
// and the clip is the last stretch, the breach, and the two lives coming off.

import { newGame, spawn, skipToApproach, actTail } from "../_helpers.mjs";

export default function item() {
  let hulkId;
  let r;
  let lives;

  return {
    id: "surge.hulk-leak",

    // A Hulk is slow (38 px/s), so even its last 120 px take about three seconds.
    clipMs: 7000,

    async arrange(api) {
      await newGame(api, "containment", "medium", 100000);
      await api.call("setLives", 10);
      hulkId = await spawn(api, "hulk", "left");
      await skipToApproach(api, hulkId);
    },

    // 420 ticks = 7s: a Hulk is slow, so its last 120 px take about three seconds.
    async act(api) {
      r = await api.until((s) => s.lives < 10, { max: 420, poll: 6 });
      lives = (await api.snapshot()).lives;
      await actTail(api, 90); // a beat on the life count sitting at 8
    },

    async assert(api, check) {
      check.expectOk("the Hulk leaked", r.hit);
      check.expectEq("a Hulk leak costs two lives", lives, 8);
    },
  };
}
