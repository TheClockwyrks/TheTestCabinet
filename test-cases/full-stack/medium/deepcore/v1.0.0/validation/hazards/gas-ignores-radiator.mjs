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
  await api.call("grantGear", { hull: 5, radiator: radiatorTier }); // top hull track, chosen radiator
  // Fill the hull EXPLICITLY rather than trusting the tier grant to have left it full — see the
  // same note in `gas-scales-depth.mjs`. The second detonation runs on a miner already at hull
  // tier 5, so its `grantGear` tops nothing up and the first blast's damage would otherwise carry
  // over, making the "shielded" reading the leftovers of the bare one rather than its own
  // measurement. `setHull` clamps to the current maximum (`specs/instrumentation.md`), so an
  // over-large value simply fills the tank.
  await api.call("setHull", 100000);
  const hull0 = (await api.snapshot()).miner.hull;
  await api.advance(30); // 30 ticks = 0.5 s with the pocket intact and the hull full
  await api.call("keyDown", K.down);
  // 600 ticks = 10 s, far past the cut this needs, so a build whose drill is slower than the table
  // in `specs/upgrades.md` fails `fuel.drill-cost` rather than reporting zero gas damage here — see
  // the same note in `gas-scales-depth.mjs`. poll 3 = the old 0.05 s chunk, fine enough that the
  // hull is read at the detonation rather than after further drilling.
  const r = await api.until((s) => s.miner.hull < hull0, { max: 600, poll: 3 });
  await api.call("keyUp", K.down);
  await api.advance(75); // 75 ticks = 1.25 s of blast and the hull bar settling at its new level
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
