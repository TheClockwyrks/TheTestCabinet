// Automated validation for the Pause sub-item `menu-esc`.
//
// `Esc` opens the pause menu (Resume / Restart / Quit), which also freezes the game and
// covers it with the menu. The check starts a live round, presses Escape, and confirms
// the game is on the paused-menu screen, then captures it.

import { startRun, MAP } from "../_helpers.mjs";

export default function item() {
  let screen;

  return {
    id: "pause.menu-esc",

    async arrange(api) {
      await startRun(api, MAP.single, { round: 1 });
      await api.call("startRound");
    },

    // The keypress and the menu it opens. `press` is a control op, so it belongs to the
    // behavior rather than the set-up; `settle` is a real repaint pause in both passes,
    // so the still shows the menu actually drawn.
    async act(api) {
      await api.call("press", "Escape");
      screen = (await api.snapshot()).screen;
      await api.settle(150);
      await api.screenshot("menu");
    },

    async assert(api, check) {
      check.expectEq("Esc opens the pause menu", screen, "paused");
    },
  };
}
