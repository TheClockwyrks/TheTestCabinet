// Shift: the clock reaching zero with the quota unmet fails the shift (out of time). The
// clock is set to a sliver as a precondition and run out; the real fail rule resolves it.

import { startFresh } from "../_helpers.mjs";

export default function item() {
  // The snapshot once the clock had run out.
  let snap;

  return {
    id: "shift.fail-time",

    // Leave half a second on the shift clock. `setClock` poses the clock and is still in
    // SECONDS — only advancing time is counted in ticks.
    async arrange(api) {
      await startFresh(api, 1);
      await api.call("setClock", 0.5);
    },

    async act(api) {
      await api.advance(60); // 60 ticks = the old 1.0s, running the clock out with the quota unmet
      snap = await api.snapshot();

      await api.settle(150); // let the shift-failed screen paint before capturing it
      await api.screenshot("result");
    },

    async assert(api, check) {
      check.expectEq(
        "the clock ran out into a failed shift",
        snap.screen,
        "level-failed",
      );
      check.expectEq(
        "the failure reason is out of time",
        snap.level.failReason,
        "out-of-time",
      );
    },
  };
}
