// Automated validation for the Controls sub-item `mute-key`.
//
// Pressing M toggles the mute state. From the title (mute off), a single M press flips
// the snapshot's `muted` flag on; the key flows through the real key handling. The
// title is captured so the reviewer sees the changed mute hint.
//
// This item never enters a round, so its `arrange` is just the reset to the title; the
// press, the reads either side of it, and the settle the capture needs are `act`.

import { actSettleShot } from "../_helpers.mjs";

export default function item() {
  // The mute flag either side of the press, checked by `assert`.
  let before;
  let after;

  return {
    id: "controls.mute-key",

    async arrange(api) {
      await api.reset();
    },

    async act(api) {
      before = (await api.snapshot()).muted;
      await api.call("press", "KeyM");
      after = (await api.snapshot()).muted;
      // settleMs 150 = the old trailing api.wait(150) before the capture. A real
      // repaint pause in both passes, not simulation time.
      await actSettleShot(api, "mute", { settleMs: 150 });
    },

    async assert(api, check) {
      check.expectEq("mute starts off at the title", before, false);
      check.expectEq("pressing M toggles mute on", after, true);
    },
  };
}
