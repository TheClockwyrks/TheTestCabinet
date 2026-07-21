// Automated validation for fuel.thrust-rate-scales.
//
// The thrust burn is speed-scaled: full rate while lifting off from a stop, easing toward a
// cheaper cruise rate once climbing fast. In a tall open shaft we measure the burn per second at
// lift-off (low upward speed) and again after the empty miner has reached cruise speed.

import {
  K,
  newRun,
  openColumn,
  solid,
  DEEPSTONE_ROW,
  SPAWN_COL,
} from "../_helpers.mjs";

// The measurement windows, as ticks and as the seconds they represent. The rates asserted below are
// fuel PER SECOND, so the divisor stays in seconds even though the advance is now in ticks.
const WINDOW_TICKS = 6; // 6 ticks = 0.1 s
const WINDOW_SECONDS = 0.1;

export default function item() {
  const col = SPAWN_COL;
  const row = DEEPSTONE_ROW;
  let rateLiftoff;
  let rateCruise;
  let b1;

  return {
    id: "fuel.thrust-rate-scales",

    // A full tank at the bottom of a tall open shaft — long enough to reach cruise climb speed.
    async arrange(api) {
      await newRun(api);
      await api.call("teleport", col, row);
      await openColumn(api, col, row - 45, row - 1); // a tall shaft to reach cruise speed
      await solid(api, col, row + 1);
      await api.call("teleport", col, row);
      await api.call("setFuel", 999);
    },

    // The whole climb is timed, so it lives here — and the clip shows the ascent the two rate
    // measurements are taken from.
    async act(api) {
      await api.call("keyDown", K.thrust);
      // Lift-off window: upward speed low → full burn rate.
      const a0 = (await api.snapshot()).miner.fuel;
      await api.advance(WINDOW_TICKS);
      const a1 = await api.snapshot();
      rateLiftoff = (a0 - a1.miner.fuel) / WINDOW_SECONDS;

      // Climb to cruise speed, then measure again. 96 ticks = 1.6 s.
      await api.advance(96);
      const b0 = (await api.snapshot()).miner.fuel;
      await api.advance(WINDOW_TICKS);
      b1 = await api.snapshot();
      rateCruise = (b0 - b1.miner.fuel) / WINDOW_SECONDS;
      await api.call("keyUp", K.thrust);
    },

    async assert(api, check) {
      check.expectGt(
        "the miner reached cruise climb speed",
        Math.abs(b1.miner.vy),
        800,
      );
      check.expectGt("lift-off burns at the full rate", rateLiftoff, 4);
      check.expectLt("cruise burns at the eased rate", rateCruise, 3);
      check.expectGt(
        "the burn eases as climb speed rises",
        rateLiftoff - rateCruise,
        1.5,
      );
    },
  };
}
