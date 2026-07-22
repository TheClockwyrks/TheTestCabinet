// Automated validation for states.dmgboard: the DMG BOARD overlay opens a live tower ranking.
// This confirms the overlay is reachable and captures it; how the ranking reads is left to
// the reviewer.
//
// Opening the run is the arrange; OPENING THE OVERLAY is the behavior under test, so the L
// press, the read and the capture are the act.

import { startBuild, snap } from "../_helpers.mjs";

// Let the overlay paint before the still is taken. 100 ms x 60 Hz = 6 ticks exactly.
const SETTLE_TICKS = 6;

export default function item() {
  // Whether the overlay reported open, read by `assert`.
  let open;

  return {
    id: "states.dmgboard",

    async arrange(api) {
      await startBuild(api);
    },

    async act(api) {
      await api.call("press", "KeyL"); // toggle the damage leaderboard
      open = (await snap(api)).overlays.dmgBoard;

      await api.advance(SETTLE_TICKS);
      await api.screenshot("board");
    },

    async assert(api, check) {
      check.expectEq("the damage leaderboard overlay is open", open, true);
    },
  };
}
