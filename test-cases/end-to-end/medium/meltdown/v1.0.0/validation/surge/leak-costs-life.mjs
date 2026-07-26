// Automated validation for the Surge sub-item `leak-costs-life`.
//
// A unit that reaches an exhaust leaks and costs the player a life (specs/surge.md —
// a Mote costs 1). We spawn a real Mote with no defense and let it walk out an
// exhaust; lives drop by exactly one.

import { newGame, spawn } from "../_helpers.mjs";

export default function item() {
  let r;
  let lives;

  return {
    id: "surge.leak-costs-life",

    // A known life count and one Mote with nothing to stop it, so the drop read back
    // is attributable to that single leak.
    async arrange(api) {
      await newGame(api, "containment", "medium", 100000);
      await api.call("setLives", 10);
      await spawn(api, "mote", "left");
    },

    // 1800 ticks = the old 30s cap, polled every 12 ticks (the old 0.2s chunk) — the
    // life count only changes at the leak.
    async act(api) {
      r = await api.until((s) => s.lives < 10, { max: 1800, poll: 12 });
      lives = (await api.snapshot()).lives;
    },

    async assert(api, check) {
      check.expectOk("the Mote leaked", r.hit);
      check.expectEq("a Mote leak costs one life", lives, 9);
    },
  };
}
