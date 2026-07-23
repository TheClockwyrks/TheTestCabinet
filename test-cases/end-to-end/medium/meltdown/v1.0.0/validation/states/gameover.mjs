// Automated validation for the States sub-item `gameover`.
//
// Losing the last life reaches the Game over (reactor breached) state
// (specs/ui.md). With one life and no defense, a single real Mote leaks and ends
// the run.

import { newGame, spawn } from "../_helpers.mjs";

export default function item() {
  let r;
  let screen;

  return {
    id: "states.gameover",

    // The still this item declares is the Game over screen, and the Mote's walk across
    // the floor to its leak takes ~15 s of real time — past the 8 s default record
    // budget, so the record pass would unwind before `screenshot` ever ran and the
    // declared output would never land. The item declares no video, so this lengthens
    // only the record pass, not any media it produces.
    clipMs: 30000,

    // One life and no towers, so the first leak is the last.
    async arrange(api) {
      await newGame(api, "containment", "medium");
      await api.call("setLives", 1);
      await spawn(api, "mote", "left");
    },

    // Let the Mote walk the floor and leak. 1800 ticks = the old 30s cap, polled every
    // 12 ticks (the old 0.2s chunk) — the screen only changes at the leak.
    async act(api) {
      r = await api.until((s) => s.screen === "gameover", {
        max: 1800,
        poll: 12,
      });
      await api.settle(120);
      screen = (await api.snapshot()).screen;
      await api.screenshot("gameover");
    },

    async assert(api, check) {
      check.expectOk("the last-life leak ends the run", r.hit);
      check.expectEq("the screen is Game over", screen, "gameover");
    },
  };
}
