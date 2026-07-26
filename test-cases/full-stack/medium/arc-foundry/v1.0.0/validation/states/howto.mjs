// Automated validation for states.howto: the how-to-play state is reachable from the title.
//
// Only the reset is arranged; NAVIGATING to the state is the behavior under test, so the menu
// move and the confirm are the act.

import { snap } from "../_helpers.mjs";

// The old script waited 80 ms after the reset for the title to come up. At 60 Hz that is 4.8
// ticks; the tick contract rejects a fraction rather than rounding it, so round UP to 5 — a
// settle must never come out shorter than it was.
const SETTLE_TICKS = 5;

export default function item() {
  // The screen the navigation landed on, read by `assert`.
  let screen;

  return {
    id: "states.howto",

    async arrange(api) {
      await api.reset();
    },

    async act(api) {
      await api.advance(SETTLE_TICKS);
      await api.call("press", "ArrowDown"); // move to HOW TO PLAY
      await api.call("press", "Enter");
      screen = (await snap(api)).screen;

      await api.advance(SETTLE_TICKS); // let the screen paint before the still
      await api.screenshot("howto");
    },

    async assert(api, check) {
      check.expectEq("the how-to-play screen is reachable", screen, "howto");
    },
  };
}
