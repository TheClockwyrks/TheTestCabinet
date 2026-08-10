// Automated validation for the Controls item `menu-confirm`: Enter (or Space) confirms the
// highlighted menu selection. From the title with PLAY highlighted, Enter starts the game;
// a fresh title then confirms with Space too.
//
// The two confirmations are separated by a return to the title, which is a reset and so may
// only happen in `arrange`. The Enter scenario therefore runs in full there (it is instant),
// leaving the game back at the title; `act` performs the Space confirmation, so the clip
// shows a real confirm starting a real game rather than a screen that is already running.

import { title } from "../_helpers.mjs";

export default function item() {
  // The screen each confirmation produced, read by `assert`.
  let afterEnter;
  let afterSpace;

  return {
    id: "controls.menu-confirm",

    async arrange(api) {
      await title(api);
      await api.call("press", "Enter"); // confirm PLAY
      afterEnter = (await api.snapshot()).screen;

      await title(api); // back to a fresh title for the Space confirmation
    },

    async act(api) {
      await api.call("press", "Space"); // Space also confirms
      afterSpace = (await api.snapshot()).screen;
      // Let the started game run so the clip shows the confirm landing in play:
      // 1 s x 120 Hz = 120 ticks.
      await api.advance(120);
    },

    async assert(api, check) {
      check.expectEq(
        "Enter confirms the selection and starts the game",
        afterEnter,
        "playing",
      );
      check.expectEq(
        "Space also confirms the selection",
        afterSpace,
        "playing",
      );
    },
  };
}
