// Automated validation for the Game States sub-item `pause`.
//
// The pause screen is reachable during a live round. A round is started, a pause key
// is pressed, and the resulting screen is read back and captured so a reviewer sees
// the actual pause menu (resume / restart / quit).
//
// The round is posed in `arrange`; the press moves into `act` behind a short run of
// live play so the clip shows the transition — a moving round, then the overlay — which
// is what "reachable during a live round" means. The screen is read after the press, so
// those ticks cannot affect the assertion.

import { actSettleShot, hLane, beginRound } from "../_helpers.mjs";

// A moment of visible play before pausing: 4 ticks = 0.5 s. From col 12 heading right
// the head reaches col 16, twelve columns clear of the wall.
const BEAT_TICKS = 4;

export default function item() {
  // The screen `act` read once the pause overlay had painted, checked by `assert`.
  let s;

  return {
    id: "states.pause",

    async arrange(api) {
      await beginRound(api);
      await api.call("setSnake", hLane(12, 8, 3), "right"); // a settled mid-board pose
    },

    async act(api) {
      await api.advance(BEAT_TICKS); // a live round on camera before the press
      await api.call("press", "Escape"); // pause
      // settleMs 120 = the old api.wait(120) before the reading and the capture.
      s = await actSettleShot(api, "pause", { settleMs: 120 });
    },

    async assert(api, check) {
      check.expectEq(
        "pressing Escape during a round pauses it",
        s.screen,
        "paused",
      );
    },
  };
}
