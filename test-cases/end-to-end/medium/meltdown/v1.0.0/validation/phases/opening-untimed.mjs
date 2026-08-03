// Automated validation for the Phases sub-item `opening-untimed`.
//
// Before Wave 1 the opening build phase is untimed: no countdown, never auto-starts
// (specs/gameplay.md). We start a game and run a long time; it stays in the opening
// phase, on Wave 1 and unreleased, with no build timer.

import { newGame, actTail } from "../_helpers.mjs";

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
    // game — it is the same 1800 steps the validate pass always took. Filming those
    // 30 s would be half a minute of a static build phase, and the skip costs the
    // verdict nothing.
    //
    // The beat AFTER it is filmed, though. "Untimed" is a claim about a number that
    // does not move, and a still cannot make it: a screenshot of a panel with no
    // countdown on it looks exactly like a screenshot of a panel whose countdown
    // happened to be caught between frames. Four seconds of the same panel — the wave
    // control reading Start, no countdown appearing, WAVE 0 holding — is the shortest
    // clip in which a reviewer can watch nothing happen and know it. The verdict is
    // read before it, off the far end of the 30 s skip, so the beat is evidence only.
    // The `settle` stays real — a screenshot needs a painted frame.
    async act(api) {
      await api.skip(1800);
      later = await api.snapshot();
      await api.settle(80);
      await api.screenshot("opening");
      await actTail(api, 240); // 4 s of the untimed phase visibly not counting down
    },

    async assert(api, check) {
      check.expectEq(
        "the game opens in the opening phase",
        start.phase,
        "opening",
      );
      // The opening phase is WAVE 1's build phase, not a wave 0: a build phase belongs
      // to the wave it is preparing for (specs/gameplay.md). What makes it the opening
      // phase is `phase`, and what makes it untimed is the absent countdown — the wave
      // number is 1 here and stays 1 until Wave 1 is cleared.
      check.expectEq("the run is on Wave 1, not yet released", start.wave, 1);
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
      check.expectEq("still Wave 1, unreleased", later.wave, 1);
      check.expectEq("still no countdown", later.buildTimer, null);
    },
  };
}
