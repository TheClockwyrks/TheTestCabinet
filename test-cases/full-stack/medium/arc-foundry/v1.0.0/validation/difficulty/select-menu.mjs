// Automated validation for difficulty.select-menu: after MAP SELECT a DIFFICULTY SELECT lets
// the player pick Easy / Medium / Hard. This confirms the screen is reachable and captures it;
// how each entry reads what it changes is judged by eye from the capture.
//
// Only the reset is arranged; NAVIGATING to the screen is the behavior under test, so the two
// confirms and the reads between them are the act, and the clip walks the menu the way a player
// would.

import { snap } from "../_helpers.mjs";

// The old script waited 80 ms after the reset for the title to come up. At 60 Hz that is 4.8
// ticks; the tick contract rejects a fraction rather than rounding it, so round UP to 5 — a
// settle must never come out shorter than it was.
const SETTLE_TICKS = 5;

export default function item() {
  // The screen after each confirm, read by `assert`.
  let atMap;
  let atDifficulty;

  return {
    id: "difficulty.select-menu",

    async arrange(api) {
      await api.reset();
    },

    async act(api) {
      await api.advance(SETTLE_TICKS);

      await api.call("press", "Enter"); // title -> map select
      atMap = (await snap(api)).screen;

      await api.call("press", "Enter"); // choose the first map -> difficulty select
      atDifficulty = (await snap(api)).screen;

      await api.advance(SETTLE_TICKS); // let the difficulty screen paint before the still
      await api.screenshot("select");
    },

    async assert(api, check) {
      check.expectEq("the map-select screen is reached", atMap, "mapselect");
      check.expectEq("the difficulty-select screen is reachable", atDifficulty, "difficultyselect");
    },
  };
}
