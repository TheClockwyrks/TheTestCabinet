// Automated validation for hazards.radiator-cuts.
//
// A higher radiator tier reduces hazard damage. We stand the miner in lava with the lowest radiator
// tier and again with the highest, reading the hull drop over the same half second.

import {
  teleportInto,
  newRun,
  SPAWN_COL,
  DEEPSTONE_ROW,
} from "../_helpers.mjs";

/**
 * ACT: stand the miner in freshly-posed lava at the given radiator tier for half a second and
 * return the hull lost. Everything it poses is a control op, so the second measurement re-poses the
 * scenario without the reset the runtime forbids inside `act`.
 */
async function actLavaLoss(api, col, row, radiatorTier) {
  await teleportInto(api, col, row);
  await api.call("setTile", col, row + 1, { kind: "lava" });
  await teleportInto(api, col, row);
  await api.call("grantGear", { hull: 5, radiator: radiatorTier }); // hull 450, refilled
  const hull0 = (await api.snapshot()).miner.hull;
  await api.advance(30); // 30 ticks = the old 0.5 s window
  return hull0 - (await api.snapshot()).miner.hull;
}

export default function item() {
  const col = SPAWN_COL;
  const row = DEEPSTONE_ROW;
  let bare;
  let shielded;

  return {
    id: "hazards.radiator-cuts",

    async arrange(api) {
      await newRun(api);
    },

    // Both exposures are timed, so both run here — and the clip shows the bare hull draining fast
    // against the shielded one holding, which is the comparison being asserted.
    async act(api) {
      bare = await actLavaLoss(api, col, row, 1); // no reduction
      shielded = await actLavaLoss(api, col, row, 5); // 80% reduction
    },

    async assert(api, check) {
      check.expectGt("bare plating takes real lava damage", bare, 8);
      check.expectLt(
        "a top radiator cuts the damage sharply",
        shielded,
        bare * 0.5,
      );
    },
  };
}
