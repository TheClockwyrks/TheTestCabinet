// Automated validation for build.cancel-free: cancelling a held (un-dropped) rock costs no
// stamp and no Charge.
//
// The press is pulled with the B key (arming a held rock), then cancelled with Esc; the stamp
// allowance and Charge are unchanged and no rock remains held.
//
// Opening the run and pulling the press are control ops, so the arrange leaves a rock held on
// the cursor. The CANCEL is the behavior under test, so it — and the reads either side of it —
// is the act, and the clip shows the held rock being put back.

import { startBuild, snap } from "../_helpers.mjs";

// Let a frame land before the still is taken, so the capture shows the cancelled (empty)
// cursor rather than the frame that still had a rock on it. 100 ms x 60 Hz = 6 ticks exactly.
const SETTLE_TICKS = 6;

export default function item() {
  // The opening allowance, and the board either side of the cancel, all read by `assert`.
  let s0;
  let s1;
  let s2;

  return {
    id: "build.cancel-free",

    async arrange(api) {
      s0 = await startBuild(api);
      await api.call("press", "KeyB"); // pull the press → a blank rock is held
    },

    async act(api) {
      s1 = await snap(api);

      await api.call("press", "Escape"); // cancel the held rock
      s2 = await snap(api);

      await api.advance(SETTLE_TICKS);
      await api.screenshot("cancel");
    },

    async assert(api, check) {
      check.expectOk("a rock is held after pulling the press", !!s1.held && s1.held.active);
      check.expectOk("no rock is held after cancelling", !s2.held || !s2.held.active);
      check.expectEq("cancelling spends no stamp", s2.stampsLeft, s0.stampsLeft);
      check.expectEq("cancelling costs no Charge", s2.charge, s0.charge);
    },
  };
}
