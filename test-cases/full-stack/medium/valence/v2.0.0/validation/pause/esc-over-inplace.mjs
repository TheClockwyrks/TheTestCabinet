// Automated validation for the Pause sub-item `esc-over-inplace`.
//
// `Esc` opens the pause menu even when the game is already paused in place — the two
// pauses are distinct. The check pauses in place with Space (screen stays the live board)
// and then presses Escape, which opens the pause-menu screen over it.

import { startRun, MAP } from "../_helpers.mjs";

export default function item() {
  let inplace;
  let overScreen;

  return {
    id: "pause.esc-over-inplace",

    // The precondition is the in-place pause; the behavior under test is what Escape
    // does ON TOP of it, so only the first press belongs here.
    async arrange(api) {
      await startRun(api, MAP.single, { round: 1 });
      await api.call("startRound");
      await api.call("press", "Space"); // in-place pause
      inplace = await api.snapshot();
    },

    // Escape over an already-paused board, and the menu it opens.
    async act(api) {
      await api.call("press", "Escape"); // opens the menu even though already paused
      overScreen = (await api.snapshot()).screen;
      await api.settle(150);
    },

    async assert(api, check) {
      check.expectEq("paused in place first", inplace.paused, true);
      check.expectEq(
        "still the live board (no menu)",
        inplace.screen,
        "playing",
      );
      check.expectEq(
        "Esc opens the pause menu over the in-place pause",
        overScreen,
        "paused",
      );
    },
  };
}
