// Automated validation for weight.heavier-slower.
//
// A heavy cargo load has a lower climb top speed than an empty miner. In the same open shaft we
// climb empty and record the top upward speed, then climb with a heavy (non-overloaded) haul and
// record it again. The heavy climb tops out clearly slower.

import {
  K,
  openColumn,
  solid,
  DEEPSTONE_ROW,
  SPAWN_COL,
} from "../_helpers.mjs";

/**
 * ACT: climb from the bottom of the shaft and return the greatest upward speed reached over
 * `ticks`.
 *
 * Sampled every 6 ticks (the old 0.1 s cadence) — coarse is fine because the climb speed rises
 * smoothly to its ceiling. The teleport back to the bottom is a control op, so the second climb
 * re-poses without the reset the runtime forbids inside `act`.
 */
async function actTopClimbSpeed(api, col, row, ticks) {
  await api.call("teleport", col, row);
  await api.call("setFuel", 999);
  await api.call("keyDown", K.thrust);
  let maxUp = 0;
  const iters = Math.ceil(ticks / 6);
  for (let i = 0; i < iters; i += 1) {
    await api.advance(6);
    const up = -(await api.snapshot()).miner.vy;
    if (up > maxUp) maxUp = up;
  }
  await api.call("keyUp", K.thrust);
  return maxUp;
}

export default function item() {
  const col = SPAWN_COL;
  const row = DEEPSTONE_ROW;
  let empty;
  let heavy;

  return {
    id: "weight.heavier-slower",

    // One tall open shaft, used for both climbs.
    async arrange(api) {
      await api.reset({ seed: 1 });
      await api.call("startExpedition", "standard", "standard");
      await openColumn(api, col, row - 45, row - 1);
      await solid(api, col, row + 1);
    },

    // Both climbs are timed, so both run here — and the clip shows the empty ascent against the
    // laden one, which is the comparison being asserted.
    async act(api) {
      empty = await actTopClimbSpeed(api, col, row, 90); // 90 ticks = the old 1.5 s window
      await api.call("addCargo", "pyronium", 5); // ~290 kg — heavy but under the tier-1 lift limit
      heavy = await actTopClimbSpeed(api, col, row, 90);
    },

    async assert(api, check) {
      check.expectGt("an empty miner climbs fast", empty, 700);
      check.expectLt("a heavy haul tops out slower", heavy, empty - 150);
    },
  };
}
