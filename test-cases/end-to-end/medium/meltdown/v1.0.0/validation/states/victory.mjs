// Automated validation for the States sub-item `victory`.
//
// Clearing the final wave reaches the Victory state (specs/states.md). We jump to the
// final wave with a huge life reserve and start it; the whole wave resolves (its
// units leak past, costing lives from a bottomless reserve) until the wave is clear,
// which the real clear-wave code turns into Victory. Nothing fabricates the state.

import { newGame } from "../_helpers.mjs";

export default function item() {
  let r;
  let screen;

  return {
    id: "states.victory",

    // The still this item declares is the Victory screen, and the final wave takes
    // ~35 s of real time to run itself out — far past the 8 s default record budget,
    // so the record pass would unwind before `screenshot` ever ran and the declared
    // output would never land. The item declares no video, so this lengthens only the
    // record pass, not any media it produces.
    clipMs: 60000,

    // The final wave, with lives deep enough that the whole wave leaking past cannot
    // end the run before it is cleared.
    async arrange(api) {
      const s0 = await newGame(api, "containment", "medium", 100000);
      await api.call("setLives", 100000000); // survive the whole final wave leaking past
      await api.call("setWave", s0.waveCount); // the final wave
      await api.call("startWave");
    },

    // Run the final wave out. 13200 ticks = the old 220s cap, polled every 30 ticks
    // (the old 0.5s chunk) — the screen only changes once, at the clear, so a coarse
    // sweep keeps this long drive cheap.
    async act(api) {
      r = await api.until((s) => s.screen === "victory", {
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
