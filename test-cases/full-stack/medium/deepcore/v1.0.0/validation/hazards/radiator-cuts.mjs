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

/** The contact window each exposure is measured over. `specs/hazards.md` puts the bare drain at
 *  `32 hull/s`, so this is `48` hull expected with no radiator and `~9.6` at the top tier's 80%
 *  cut. The old window was half as long, which made the whole clip about a second — too brief to
 *  watch a bar move, let alone compare two of them. */
const CONTACT_TICKS = 90; // 90 ticks = 1.5 s

/**
 * ACT: stand the miner in freshly-posed lava at the given radiator tier for the contact window and
 * return the hull lost. Everything it poses is a control op, so the second measurement re-poses the
 * scenario without the reset the runtime forbids inside `act`.
 */
async function actLavaLoss(api, col, row, radiatorTier) {
  await teleportInto(api, col, row);
  await api.call("setTile", col, row + 1, { kind: "lava" });
  await teleportInto(api, col, row);
  await api.call("grantGear", { hull: 5, radiator: radiatorTier });
  // Fill the hull explicitly: the second exposure runs on a miner already at hull tier 5, so its
  // `grantGear` raises no maximum and tops nothing up (`specs/upgrades.md` adds only a tier's
  // capacity INCREASE to the current hull), and the first exposure's damage would otherwise carry
  // into the shielded reading. `setHull` clamps to the maximum (`specs/instrumentation.md`).
  await api.call("setHull", 100000);
  const hull0 = (await api.snapshot()).miner.hull;
  await api.advance(15); // 15 ticks = 0.25 s settling onto the pool with the hull bar full
  const hull1 = (await api.snapshot()).miner.hull;
  await api.advance(CONTACT_TICKS);
  const lost = hull1 - (await api.snapshot()).miner.hull;
  await api.advance(30); // 30 ticks = 0.5 s resting on where the bar ended up
  return lost;
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
      // `32 hull/s` bare (`specs/hazards.md`) over the 1.5 s window is `48`; requiring half of that
      // keeps the same tolerance the old half-second window carried, so a build is not pinned to
      // hitting the rate on the nose.
      check.expectGt("bare plating takes real lava damage", bare, 24);
      check.expectLt(
        "a top radiator cuts the damage sharply",
        shielded,
        bare * 0.5,
      );
    },
  };
}
