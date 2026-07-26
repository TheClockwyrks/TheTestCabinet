// Automated validation for hazards.gas-ignores-radiator.
//
// Unlike lava, a gas detonation is NOT reduced by the radiator — hull is the only counter to gas.
// We detonate the same gas pocket once with the lowest radiator tier and once with the highest,
// each with a high hull so both are survivable and the full damage registers, and confirm the hull
// loss is the same either way.

import {
  teleportInto,
  K,
  newRun,
  standAt,
  SPAWN_COL,
  ROCKBED_ROW,
} from "../_helpers.mjs";

/**
 * ACT: detonate a freshly-posed gas pocket at the given radiator tier and return the hull lost.
 *
 * Everything it poses is a control op, so the second detonation re-poses the scenario without the
 * reset the runtime forbids inside `act`.
 */
async function actGasHullLoss(api, col, row, radiatorTier) {
  await standAt(api, col, row);
  await api.call("setTile", col, row + 1, { kind: "gas" });
  await api.call("setTile", col, row + 2, { kind: "rock" });
  await teleportInto(api, col, row);
  await api.call("grantGear", { hull: 5, radiator: radiatorTier }); // 450 hull, refilled
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
  const row = ROCKBED_ROW;
  let bare;
  let shielded;

  return {
    id: "hazards.gas-ignores-radiator",

    async arrange(api) {
      await newRun(api);
    },

    // Both detonations are timed, so both run here — and the clip shows the pair back to back,
    // which is the comparison being asserted.
    async act(api) {
      bare = await actGasHullLoss(api, col, row, 1); // no radiator
      shielded = await actGasHullLoss(api, col, row, 5); // 80% radiator — irrelevant to gas
    },

    async assert(api, check) {
      check.expectGt("a gas detonation costs real hull", bare, 40);
      check.expectLt(
        "the radiator does NOT reduce gas (same loss both tiers)",
        Math.abs(bare - shielded),
        1,
      );
    },
  };
}
