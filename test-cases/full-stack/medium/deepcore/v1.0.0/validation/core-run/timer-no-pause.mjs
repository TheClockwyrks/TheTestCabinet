// Automated validation for core-run.timer-no-pause.
//
// The Core Sample countdown keeps running while a panel or the inventory is open — there is no free
// pause. We extract the Sample, open the inventory, and confirm the timer still falls with stepped
// time behind the open overlay.

import { newRun } from "../_helpers.mjs";

export default function item() {
  let s0;
  let s1;

  return {
    id: "core-run.timer-no-pause",

    // A live Sample with the inventory overlay open over the top of it.
    async arrange(api) {
      await newRun(api);
      await api.call("spawnCoreSample");
      await api.call("openInventory");
      s0 = await api.snapshot();
    },

    // Time running on behind the open overlay is the behavior, and the clip shows exactly that.
    async act(api) {
      await api.advance(300); // 300 ticks = 5 s
      s1 = await api.snapshot();
    },

    async assert(api, check) {
      check.expectEq("the inventory overlay is open", s0.panel, "inventory");
      check.expectEq("the overlay is still open", s1.panel, "inventory");
      check.expectClose(
        "the timer kept running behind the overlay",
        s0.coreTimer - s1.coreTimer,
        5,
        0.5,
      );
    },
  };
}
