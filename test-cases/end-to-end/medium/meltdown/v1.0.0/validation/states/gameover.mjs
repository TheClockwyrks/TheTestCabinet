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

    // One life and no towers, so the first leak is the last.
    async arrange(api) {
      await newGame(api, "containment", "medium");
      await api.call("setLives", 1);
      await spawn(api, "mote", "left");
    },

    // Let the Mote walk the floor and leak, unfilmed. 1800 ticks = the old 30s cap,
    // polled every 12 ticks (the old 0.2s chunk) — the screen only changes at the leak.
    //
    // The declared output is a STILL of the Game over screen and this item records no
    // video, so the walk had nothing to be filmed for: in real time it only made the
    // record pass wait out 15 s before taking one screenshot, and needed a `clipMs`
    // override to stop the budget unwinding the pass first. The leak, and the run
    // ending on it, are still entirely the game's own. The `settle` stays real — a
    // screenshot needs a painted frame.
    async act(api) {
      r = await api.skipUntil((s) => s.screen === "gameover", {
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
