// Automated validation for controls.pause-space: once a wave is live, pressing Space toggles
// the in-place pause.
//
// Opening the run and putting a unit on the floor are control ops (the arrange). Letting the
// wave actually run, pausing it, and resuming is the behavior under test — so the act shows the
// board moving, freezing on the Space press, and moving again, which is the whole point.

import { startBuild, spawnControlled, snap, SECOND } from "../_helpers.mjs";

// 0.2 s = 12 ticks of live motion before the pause, so the freeze is visible as a change.
const BEFORE_PAUSE_TICKS = 0.2 * SECOND;
// Hold on the frozen board so the pause reads as a pause and not a dropped frame.
const HELD_TICKS = 1 * SECOND;
// Then resume and show motion returning.
const RESUMED_TICKS = 1.5 * SECOND;

export default function item() {
  // The board at the instant the pause took hold, read by `assert`.
  let s;

  return {
    id: "controls.pause-space",

    async arrange(api) {
      await startBuild(api);
      await spawnControlled(api, "mote"); // a live wave
    },

    async act(api) {
      await api.advance(BEFORE_PAUSE_TICKS);
      await api.call("press", "Space");

      s = await snap(api);

      await api.advance(HELD_TICKS); // the board is frozen: nothing moves
      await api.call("press", "Space"); // resume
      await api.advance(RESUMED_TICKS);
    },

    async assert(api, check) {
      check.expectOk("pressing Space during a wave paused in place", s.paused === true);
      check.expectEq("...the screen stays on the board (no menu)", s.screen, "playing");
    },
  };
}
