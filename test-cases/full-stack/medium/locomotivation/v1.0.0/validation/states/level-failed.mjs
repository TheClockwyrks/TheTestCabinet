// State: the shift-failed screen is reachable by running the clock out.

import { startFresh } from "../_helpers.mjs";

export default function item() {
  // The screen the failure reached.
  let screen;

  return {
    id: "states.level-failed",

    // Leave half a second on the shift clock. `setClock` poses the clock and is still in
    // SECONDS — only advancing time is counted in ticks.
    async arrange(api) {
      await startFresh(api, 1);
      await api.call("setClock", 0.5);
    },

    // Run the clock out for real, then let the failure screen paint before reading and
    // capturing it. 60 ticks = the old 1.0s.
    async act(api) {
      await api.advance(60);

      await api.settle(150);
      screen = (await api.snapshot()).screen;
      await api.screenshot("state");
    },

    async assert(api, check) {
      check.expectEq(
        "failing reaches the shift-failed screen",
        screen,
        "level-failed",
      );
    },
  };
}
