// Automated validation for the Pause sub-item `menu-esc`.
//
// `Esc` opens the pause menu (Resume / Restart / Quit), which also freezes the game and
// covers it with the menu. The check starts a live round, presses Escape, and confirms
// the game is on the paused-menu screen, then captures it.

import {
  startRun,
  clipBudget,
  LEAD_TICKS,
  TAIL_TICKS,
  MAP,
} from "../_helpers.mjs";

export default function item() {
  let screen;

  return {
    id: "pause.menu-esc",

    clipMs: clipBudget(LEAD_TICKS + TAIL_TICKS),

    async arrange(api) {
      await startRun(api, MAP.single, { round: 1 });
      await api.call("startRound");
    },

    // The keypress and the menu it opens — as a PLAYBACK. A still of the pause menu is a
    // picture of a menu; it says nothing about the live round it was opened over, which is
    // the whole claim. `press` is a control op, so it belongs to the behavior rather than
    // the set-up.
    async act(api) {
      // The round running, no menu.
      await api.advance(LEAD_TICKS);

      await api.call("press", "Escape");
      screen = (await api.snapshot()).screen;

      // Held on the menu, with the frozen board behind it.
      await api.settle(150);
      await api.advance(TAIL_TICKS);
    },

    async assert(api, check) {
      check.expectEq("Esc opens the pause menu", screen, "paused");
    },
  };
}
