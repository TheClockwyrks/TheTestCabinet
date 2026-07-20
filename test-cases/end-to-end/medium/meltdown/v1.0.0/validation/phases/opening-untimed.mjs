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

    // The still this item declares is the opening phase still holding, and the whole
    // point of the drive is that it is LONG — 1800 ticks is 30 s of real time in the
    // record pass, far past the 8 s default budget, so the record pass would unwind
    // before `screenshot` ever ran and the declared output would never land. The wait
    // is the check, so it is lengthened here rather than shortened. The item declares
    // no video, so this lengthens only the record pass, not any media it produces.
    clipMs: 36000,

    async arrange(api) {
      start = await newGame(api, "containment", "medium");
    },

    // 1800 ticks = the old 30s, far longer than any build countdown — if the phase
    // were timed at all, it would have auto-started well inside this.
    async act(api) {
      await api.advance(1800);
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
