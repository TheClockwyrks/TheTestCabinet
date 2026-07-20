// Automated validation for states.difficultyselect: the difficulty-select state is reachable
// after a map is chosen.
//
// Only the reset is arranged; NAVIGATING to the state is the behavior under test, so the two
// confirms are the act and the clip walks the menu the way a player would.

import { snap } from "../_helpers.mjs";

// The old script waited 80 ms after the reset for the title to come up. At 60 Hz that is 4.8
// ticks; the tick contract rejects a fraction rather than rounding it, so round UP to 5 — a
// settle must never come out shorter than it was.
const SETTLE_TICKS = 5;

export default function item() {
  // The screen the navigation landed on, read by `assert`.
  let screen;

  return {
    id: "states.difficultyselect",

    async arrange(api) {
      await api.reset();
    },

    async act(api) {
      await api.advance(SETTLE_TICKS);
      await api.call("press", "Enter"); // title -> map select
      await api.call("press", "Enter"); // choose the first map -> difficulty select
      screen = (await snap(api)).screen;

      await api.advance(SETTLE_TICKS); // let the screen paint before the still
      await api.screenshot("difficultyselect");
    },

    async assert(api, check) {
      check.expectEq("the difficulty-select screen is reachable", screen, "difficultyselect");
    },
  };
}
