// Automated validation for build.type-uniform: the component TYPE roll is uniform across the
// eight base types — over many re-seeded rolls, every one of the eight appears.
//
// The sweep resets the run up to 48 times, which only `arrange` may do; it consumes no game
// time, so it belongs there regardless. The act then holds on the board the sweep left standing
// long enough to capture the still.

import { startBuild, towerAt, snap } from "../_helpers.mjs";

// A frame for the still. 100 ms x 60 Hz = 6 ticks exactly.
const SETTLE_TICKS = 6;

export default function item() {
  // The distinct types the sweep rolled, read by `assert`.
  const types = new Set();

  return {
    id: "build.type-uniform",

    async arrange(api) {
      for (let seed = 1; seed <= 48 && types.size < 8; seed += 1) {
        await startBuild(api, { seed });
        await api.call("setNextRoll", null);
        await api.call("placeRock", 6, 7);
        const t = towerAt(await snap(api), 6, 7);
        if (t) types.add(t.type);
      }
    },

    async act(api) {
      await api.advance(SETTLE_TICKS);
      await api.screenshot("types");
    },

    async assert(api, check) {
      check.expectEq("all eight base component types appear across many rolls", types.size, 8);
    },
  };
}
