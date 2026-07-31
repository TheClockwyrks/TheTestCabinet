// Automated validation for the Phases sub-item `opening-untimed`.
//
// Before Wave 1 the opening build phase is untimed: no countdown, never auto-starts
// (specs/economy.md, states.md). We start a game and run a long time; it stays in
// the opening phase at wave 0 with no build timer.

import { newGame } from "../_helpers.mjs";

export default function item() {
  let start;
  let later;

  return {
    id: "phases.opening-untimed",

    async arrange(api) {
      start = await newGame(api, "containment", "medium");
    },

    // 1800 ticks = the old 30s, far longer than any build countdown — if the phase
    // were timed at all, it would have auto-started well inside this.
    //
    // Skipped, not waited out. The check is that 30 s of SIMULATION pass without the
    // phase advancing, and a skip runs every one of those ticks through the real
    // game — it is the same 1800 steps the validate pass always took. What real time
    // added was 30 s of the record pass staring at a static build phase to produce one
    // screenshot of it, plus a `clipMs` override to stop the budget unwinding the pass
    // before `screenshot` ran. The item declares no video, so none of that was ever
    // going to be seen. The `settle` stays real — a screenshot needs a painted frame.
    async act(api) {
      await api.skip(1800);
      later = await api.snapshot();
      await api.settle(80);
      await api.screenshot("opening");
    },

    async assert(api, check) {
      check.expectEq(
        "the game opens in the opening phase",
        start.phase,
        "opening",
      );
      check.expectEq("no wave has started (wave 0)", start.wave, 0);
      check.expectEq(
        "the opening phase shows no countdown",
        start.buildTimer,
        null,
      );

      check.expectEq(
        "it never auto-starts (still the opening phase)",
        later.phase,
        "opening",
      );
      check.expectEq("still wave 0", later.wave, 0);
      check.expectEq("still no countdown", later.buildTimer, null);
    },
  };
}
