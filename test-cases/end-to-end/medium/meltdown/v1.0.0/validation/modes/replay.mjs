// Automated validation for the Modes sub-item `replay`.
//
// RESTART and PLAY AGAIN replay the same mode and difficulty (specs/modes.md). We
// drive a Containment/Medium run to Game over, then choose PLAY AGAIN and confirm the
// fresh run is the same mode and difficulty.

import { newGame, spawn, press } from "../_helpers.mjs";

export default function item() {
  let over;
  let s;

  return {
    id: "modes.replay",

    // A Containment/Medium run on its last life, so one Mote ends it — the replay has
    // to come out of a REAL game-over, not a posed one.
    async arrange(api) {
      await newGame(api, "containment", "medium");
      await api.call("setLives", 1);
      await spawn(api, "mote", "left");
    },

    // Run to the game over, then take PLAY AGAIN. 1800 ticks = the old 30s cap,
    // polled every 12 ticks (the old 0.2s chunk).
    //
    // Note PLAY AGAIN goes through the game's own menu, not `newGame` — which is the
    // point of the check, and also why nothing here needs `restartGame`.
    async act(api) {
      over = await api.until((t) => t.screen === "gameover", {
        max: 1800,
        poll: 12,
      });
      await press(api, "Enter"); // PLAY AGAIN
      s = await api.snapshot();
    },

    async assert(api, check) {
      check.expectOk("the run ended in Game over", over.hit);
      check.expectEq(
        "PLAY AGAIN starts a fresh playing run",
        s.screen,
        "playing",
      );
      check.expectEq("it replays the same mode", s.mode, "containment");
      check.expectEq("it replays the same difficulty", s.difficulty, "medium");
    },
  };
}
