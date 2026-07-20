// Automated validation for states.mapselect: the map-select state is reachable from the title.
//
// Only the reset is arranged; NAVIGATING to the state is the behavior under test, so the
// confirm is the act.

import { snap } from "../_helpers.mjs";

// The old script waited 80 ms after the reset for the title to come up. At 60 Hz that is 4.8
// ticks; the tick contract rejects a fraction rather than rounding it, so round UP to 5 — a
// settle must never come out shorter than it was.
const SETTLE_TICKS = 5;

export default function item() {
  // The screen the confirm landed on, read by `assert`.
  let screen;

  return {
    id: "states.mapselect",

    async arrange(api) {
      await api.reset();
    },

    async act(api) {
      await api.advance(SETTLE_TICKS);
      await api.call("press", "Enter"); // confirm SALVAGE at the title
      screen = (await snap(api)).screen;

      await api.advance(SETTLE_TICKS); // let the screen paint before the still
      await api.screenshot("mapselect");
    },

    async assert(api, check) {
      check.expectEq("the map-select screen is reachable", screen, "mapselect");
    },
  };
}
