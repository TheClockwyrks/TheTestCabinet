// Automated validation for fuel.out-death.
//
// Fuel reaching 0 while underground strands the miner and ends the run at Game Over with an
// out-of-fuel cause. We set fuel to 0 on a grounded underground miner and step the real sim until
// the death resolves.

import { newRun, standAt, ROCKBED_ROW, SPAWN_COL } from "../_helpers.mjs";

export default function item() {
  const col = SPAWN_COL;
  const row = ROCKBED_ROW;
  let r;

  return {
    id: "fuel.out-death",

    // A grounded underground miner with a dry tank — the death itself is left to the real path.
    async arrange(api) {
      await newRun(api);
      await standAt(api, col, row);
      await api.call("setFuel", 0);
    },

    async act(api) {
      // 180 ticks = the old 3 s cap; poll 6 = the old 0.1 s chunk (nothing read changes before the
      // death lands, so a coarse poll is enough).
      r = await api.until((s) => s.screen === "game-over", {
        max: 180,
        poll: 6,
      });
    },

    async assert(api, check) {
      check.expectEq(
        "running dry underground ends the run",
        r.snap.screen,
        "game-over",
      );
      check.expectEq(
        "the death cause is out of fuel",
        r.snap.summary ? r.snap.summary.deathCause : null,
        "fuel-out",
      );
    },
  };
}
