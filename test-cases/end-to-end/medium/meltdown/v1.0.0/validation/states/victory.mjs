// Automated validation for the States sub-item `victory`.
//
// Clearing the final wave reaches the Victory state (specs/ui.md). We jump to the
// final wave with a huge life reserve and start it; the whole wave resolves (its
// units leak past, costing lives from a bottomless reserve) until the wave is clear,
// which the real clear-wave code turns into Victory. Nothing fabricates the state.

import { newGame } from "../_helpers.mjs";

export default function item() {
  let r;
  let screen;

  return {
    id: "states.victory",

    // The final wave, with lives deep enough that the whole wave leaking past cannot
    // end the run before it is cleared.
    async arrange(api) {
      const s0 = await newGame(api, "containment", "medium", 100000);
      await api.call("setLives", 100000000); // survive the whole final wave leaking past
      await api.call("setWave", s0.waveCount); // the final wave
      await api.call("startWave");
    },

    // Run the final wave out, unfilmed. 13200 ticks = the old 220s cap, polled every
    // 30 ticks (the old 0.5s chunk) — the screen only changes once, at the clear, so
    // a coarse sweep keeps this long drive cheap.
    //
    // The declared output here is a STILL of the Victory screen; this item records no
    // video at all. So there is nothing for the wave to be filmed FOR — running it in
    // real time only made the record pass sit through 35 s of units walking before it
    // could take one screenshot, and forced a `clipMs` override to keep the budget
    // from unwinding the pass before `screenshot` ran. Skipping it lands on the same
    // Victory screen, reached the same way by the same clear-wave code, in no time at
    // all. The `settle` stays real: a screenshot still needs a painted frame.
    async act(api) {
      r = await api.skipUntil((s) => s.screen === "victory", {
        max: 13200,
        poll: 30,
      });
      await api.settle(120);
      screen = (await api.snapshot()).screen;
      await api.screenshot("victory");
    },

    async assert(api, check) {
      check.expectOk("clearing the final wave reaches Victory", r.hit);
      check.expectEq("the screen is Victory", screen, "victory");
    },
  };
}
