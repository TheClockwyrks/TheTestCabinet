// Automated validation for the Surge sub-item `leak-costs-life`.
//
// A unit that reaches an exhaust leaks and costs the player a life (specs/surge.md —
// a Mote costs 1). We spawn a real Mote with no defense and let it walk out an
// exhaust; lives drop by exactly one.
//
// The Mote's walk is 950 px at 60 px/s, and none of it is evidence: the claim is
// about what happens when it arrives. So `arrange` skips the crossing unfilmed and
// hands `act` a Mote on final approach, and the clip is the arrival, the leak and the
// life coming off the HUD rather than a quarter-minute of walking.

import { newGame, spawn, skipToApproach, actTail } from "../_helpers.mjs";

export default function item() {
  let moteId;
  let r;
  let lives;

  return {
    id: "surge.leak-costs-life",

    // Only the Mote's final approach and the leak are filmed. The ceiling stops a build
    // that routes it the long way round from filming the detour.
    clipMs: 5500,

    // A known life count and one Mote with nothing to stop it, so the drop read back
    // is attributable to that single leak.
    async arrange(api) {
      await newGame(api, "containment", "medium", 100000);
      await api.call("setLives", 10);
      moteId = await spawn(api, "mote", "left");
      await skipToApproach(api, moteId);
    },

    // 300 ticks = 5s, ample for the last stretch of the approach the skip stopped on.
    async act(api) {
      r = await api.until((s) => s.lives < 10, { max: 300, poll: 6 });
      lives = (await api.snapshot()).lives;
      await actTail(api, 90); // a beat on the life count sitting at 9
    },

    async assert(api, check) {
      check.expectOk("the Mote leaked", r.hit);
      check.expectEq("a Mote leak costs one life", lives, 9);
    },
  };
}
