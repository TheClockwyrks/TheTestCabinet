// Automated validation for the Modes sub-item `sudden-death`.
//
// Sudden Death gives one life, so a single leak ends the game (specs/modes.md). We
// start it, confirm the one life, and let a single real Mote leak.

import { newGame, spawn } from "../_helpers.mjs";

export default function item() {
  let s;
  let r;

  return {
    id: "modes.sudden-death",

    // The mode's own life count is read as it starts — nothing poses it, because the
    // single life IS the thing under test.
    async arrange(api) {
      s = await newGame(api, "suddendeath");
      await spawn(api, "mote", "left");
    },

    // Let the one Mote walk the empty floor and leak. 1800 ticks = the old 30s cap,
    // polled every 12 ticks (the old 0.2s chunk) — the screen only changes at the
    // leak.
    async act(api) {
      r = await api.until((t) => t.screen === "gameover", {
        max: 1800,
        poll: 12,
      });
    },

    async assert(api, check) {
      check.expectEq("Sudden Death starts with one life", s.lives, 1);
      check.expectOk("a single leak ends the game", r.hit);
    },
  };
}
