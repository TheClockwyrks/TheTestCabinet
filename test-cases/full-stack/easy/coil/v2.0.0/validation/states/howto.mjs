// Automated validation for the Game States sub-item `howto`.
//
// The how-to-play screen is reachable from the title menu. From the title, the menu is
// navigated down to HOW TO PLAY with injected keys and confirmed; the screen is read
// back and captured.
//
// Menu navigation is a pair of instant presses, so it is `arrange`; `act` is the settle
// the capture needs, so the still shows the drawn how-to screen rather than the title
// it just left.

import { actSettleShot } from "../_helpers.mjs";

export default function item() {
  // The screen `act` read once the how-to page had painted, checked by `assert`.
  let s;

  return {
    id: "states.howto",

    async arrange(api) {
      await api.reset();
      await api.call("press", "ArrowDown"); // play entry -> HOW TO PLAY
      await api.call("press", "Enter"); // open How to Play
    },

    async act(api) {
      // settleMs 120 = the old api.wait(120) before the reading and the capture.
      s = await actSettleShot(api, "howto", { settleMs: 120 });
    },

    async assert(api, check) {
      check.expectEq(
        "selecting How to Play opens the how-to screen",
        s.screen,
        "howto",
      );
    },
  };
}
