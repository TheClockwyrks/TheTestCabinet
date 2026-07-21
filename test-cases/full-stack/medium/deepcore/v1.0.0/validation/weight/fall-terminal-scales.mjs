// Automated validation for weight.fall-terminal-scales.
//
// Cargo weight raises the terminal fall speed, so a heavy plunge reaches a much higher speed than an
// empty one. In the same long open shaft we drop empty and record the top downward speed, then drop
// with a heavy haul and record it again.

import { openColumn, solid, ROCKBED_ROW, SPAWN_COL } from "../_helpers.mjs";

/**
 * ACT: drop from the top of the shaft and return the greatest downward speed reached over `ticks`.
 *
 * Sampled every 6 ticks (the old 0.1 s cadence) — coarse is fine here because the speed climbs
 * smoothly to its terminal and stays there. The teleport back to the top is a control op, so the
 * second drop re-poses without the reset the runtime forbids inside `act`.
 */
async function actTopFallSpeed(api, col, row, ticks) {
  await api.call("teleport", col, row);
  let maxDown = 0;
  const iters = Math.ceil(ticks / 6);
  for (let i = 0; i < iters; i += 1) {
    await api.advance(6);
    const vy = (await api.snapshot()).miner.vy;
    if (vy > maxDown) maxDown = vy;
  }
  return maxDown;
}

export default function item() {
  const col = SPAWN_COL;
  const row = ROCKBED_ROW;
  let empty;
  let heavy;

  return {
    id: "weight.fall-terminal-scales",

    // One very long open shaft, used for both drops.
    async arrange(api) {
      await api.reset({ seed: 1 });
      await api.call("startExpedition", "standard", "standard");
      await openColumn(api, col, row + 1, row + 60);
      await solid(api, col, row + 61);
    },

    // Both plunges are timed, so both run here — and the clip shows the empty drop against the
    // laden one, which is the comparison being asserted.
    async act(api) {
      empty = await actTopFallSpeed(api, col, row, 120); // 120 ticks = the old 2.0 s window
      await api.call("addCargo", "pyronium", 5); // ~290 kg
      heavy = await actTopFallSpeed(api, col, row, 120);
    },

    async assert(api, check) {
      check.expectGt("an empty miner reaches its fall terminal", empty, 700);
      check.expectGt("a heavy haul falls much faster", heavy, empty + 150);
    },
  };
}
