// Automated validation for the Pause sub-item `esc-over-inplace`.
//
// `Esc` opens the pause menu even when the game is already paused in place — the two
// pauses are distinct. The check pauses in place with Space (screen stays the live board)
// and then presses Escape, which opens the pause-menu screen over it.

import {
  startRun,
  clipBudget,
  LEAD_TICKS,
  TAIL_TICKS,
  MAP,
} from "../_helpers.mjs";

export default function item() {
  let inplace;
  let overScreen;

  return {
    id: "pause.esc-over-inplace",

    clipMs: clipBudget(2 * LEAD_TICKS + TAIL_TICKS),

    async arrange(api) {
      await startRun(api, MAP.single, { round: 1 });
      await api.call("startRound");
    },

    // Both presses, and the two distinct states they produce. The in-place pause was
    // previously applied in `arrange`, which meant the clip opened on a board that was
    // already frozen — so the one thing this item is about, a menu opening OVER an existing
    // in-place pause, had no visible "existing in-place pause" to open over.
    async act(api) {
      // The round running.
      await api.advance(LEAD_TICKS);

      await api.call("press", "Space"); // in-place pause
      inplace = await api.snapshot();
      // Held frozen, on the live board, with no menu — the state Escape is about to layer over.
      await api.advance(LEAD_TICKS);

      await api.call("press", "Escape"); // opens the menu even though already paused
      overScreen = (await api.snapshot()).screen;
      await api.settle(150);
      await api.advance(TAIL_TICKS);
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
