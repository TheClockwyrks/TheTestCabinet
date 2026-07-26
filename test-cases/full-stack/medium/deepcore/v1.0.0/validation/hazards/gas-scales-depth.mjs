// Automated validation for hazards.gas-scales-depth.
//
// A gas detonation deep in the coreshell deals far more hull damage than one in the shallow
// rockbed. We detonate a gas pocket at each depth with a high hull (so both are survivable and the
// full damage registers) and the same tier-1 radiator, and compare the hull dropped.

import {
  teleportInto,
  K,
  newRun,
  standAt,
  SPAWN_COL,
  ROCKBED_ROW,
  CORESHELL_ROW,
} from "../_helpers.mjs";

/**
 * ACT: detonate a freshly-posed gas pocket at the given row and return the hull lost.
 *
 * Everything it poses is a control op, so the second detonation re-poses the scenario at a new
 * depth without the reset the runtime forbids inside `act`.
 */
async function actGasHullLoss(api, col, row) {
  await standAt(api, col, row);
  await api.call("setTile", col, row + 1, { kind: "gas" });
  await api.call("setTile", col, row + 2, { kind: "rock" });
  await teleportInto(api, col, row);
  await api.call("grantGear", { hull: 5 }); // 450 max hull, refilled; radiator stays tier 1 (no cut)
  const hull0 = (await api.snapshot()).miner.hull;
  await api.call("keyDown", K.down);
  // 180 ticks = the old 3 s cap; poll 3 = the old 0.05 s chunk, fine enough that the hull is read
  // at the detonation rather than after further drilling.
  const r = await api.until((s) => s.miner.hull < hull0, { max: 180, poll: 3 });
  await api.call("keyUp", K.down);
  return hull0 - r.snap.miner.hull;
}

export default function item() {
  const col = SPAWN_COL;
  let shallow;
  let deep;

  return {
    id: "hazards.gas-scales-depth",

    async arrange(api) {
      await newRun(api);
    },

    // Both detonations are timed, so both run here — and the clip shows the shallow pocket against
    // the deep one, which is the comparison being asserted.
    async act(api) {
      shallow = await actGasHullLoss(api, col, ROCKBED_ROW);
      deep = await actGasHullLoss(api, col, CORESHELL_ROW);
    },

    async assert(api, check) {
      check.expectGt("a shallow gas pocket costs hull", shallow, 5);
      check.expectGt("a deep gas pocket costs far more", deep, 40);
      check.expectGt("gas damage scales with depth", deep, shallow * 1.8);
    },
  };
}
