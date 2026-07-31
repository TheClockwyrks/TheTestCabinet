// Automated validation for the Modes sub-item `sudden-death`.
//
// Sudden Death gives one life, so a single leak ends the game (specs/modes.md). We
// start it, confirm the one life, and let a single real Mote leak.

import { newGame, spawn, skipToApproach, actTail } from "../_helpers.mjs";

export default function item() {
  let s;
  let r;

  return {
    id: "modes.sudden-death",

    // The Mote's approach and the Game-over it causes. The ceiling stops a build that
    // walks it the long way round from filming the whole detour.
    clipMs: 6000,

    // The mode's own life count is read as it starts — nothing poses it, because the
    // single life IS the thing under test. The Mote's walk to the exhaust is then run
    // through unfilmed: the mode is defined by what its first leak DOES, not by the
    // sixteen seconds of walking that precede it.
    async arrange(api) {
      s = await newGame(api, "suddendeath");
      const moteId = await spawn(api, "mote", "left");
      await skipToApproach(api, moteId);
    },

    // Let the one Mote finish its approach and leak. 300 ticks = 5s, ample for the
    // stretch the skip stopped on; the screen only changes at the leak.
    async act(api) {
      r = await api.until((t) => t.screen === "gameover", {
        max: 300,
        poll: 6,
      });
      await actTail(api, 120); // 2 s on the Game-over screen the one leak caused
    },

    async assert(api, check) {
      check.expectEq("Sudden Death starts with one life", s.lives, 1);
      check.expectOk("a single leak ends the game", r.hit);
    },
  };
}
