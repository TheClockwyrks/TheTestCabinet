// Automated validation for combos.upgrade-climbs: UPGRADE raises a combination tower's level
// (up to 3) for Charge, scaling its damage and range up.
//
// Assembling the combo is the arrange; buying the upgrade is the behavior under test, so it is
// the act, and the clip carries on a little so the upgraded tower is seen firing at the wave
// the assembly launched.

import { assembleCombo, towerById, snap, SECOND } from "../_helpers.mjs";

const CLIP_TICKS = 2 * SECOND;

export default function item() {
  // The combo before and after the upgrade, read by `assert`.
  let comboId;
  let dmg0;
  let range0;
  let c1;

  return {
    id: "combos.upgrade-climbs",

    async arrange(api) {
      ({ comboId } = await assembleCombo(api, "fusecluster", { seed: 1, charge: 400 }));
    },

    async act(api) {
      const c0 = towerById(await snap(api), comboId);
      dmg0 = c0.damage;
      range0 = c0.range;

      await api.call("setCharge", 9999);
      await api.call("upgradeCombo", comboId);
      c1 = towerById(await snap(api), comboId);

      // The assertions are already fixed on `c1`; this only lets the clip show the upgraded
      // tower working.
      await api.advance(CLIP_TICKS);
    },

    async assert(api, check) {
      check.expectEq("upgrading raised the combo's level", c1.level, 1);
      check.expectGt("...scaling its damage up", c1.damage, dmg0);
      check.expectGe("...and not decreasing its range", c1.range, range0);
    },
  };
}
