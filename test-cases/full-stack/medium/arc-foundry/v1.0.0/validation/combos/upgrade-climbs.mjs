// Automated validation for combos.upgrade-climbs: UPGRADE raises a combination tower's level
// (up to 3) for Charge, scaling its damage and range up.
//
// Assembling the combo is the arrange; buying the upgrade is the behavior under test, so it is
// the act.
//
// WHAT THE CLIP SHOWS. The old one opened on the upgrade already being bought — `act`'s very
// first operations were `setCharge` and `upgradeCombo` — so the level had climbed before the
// recording's first frame and the remaining two seconds were a tower at level 1 with no level 0
// to compare it against. Nothing in it read as a climb. Now the clip holds on the combo working
// at level 0 first, with a Load walking into its reach and its Charge cost affordable on the
// HUD, and only then buys the upgrade and carries on — so the before and the after are both in
// the same clip, in that order.
//
// The assertions say the same thing the clip does: the level is read BEFORE as well as after,
// so "it climbed" is a measured step from 0 to 1 rather than an unanchored reading of 1.

import {
  assembleCombo,
  releaseSpread,
  skipToApproach,
  towerById,
  snap,
  SECOND,
} from "../_helpers.mjs";

// A beat at level 0, then the upgrade, then a longer beat at level 1. The 'before' carries the
// larger share: the claim is that the upgrade CHANGED something, and a reviewer can only judge
// that against enough of the tower working at its landing level to read its stats and its rate.
const BEFORE_TICKS = 3.5 * SECOND;
const AFTER_TICKS = 3 * SECOND;

export default function item() {
  // The combo before and after the upgrade, read by `assert`.
  let comboId;
  let level0;
  let dmg0;
  let range0;
  let c1;

  return {
    id: "combos.upgrade-climbs",

    async arrange(api) {
      ({ comboId } = await assembleCombo(api, "fusecluster", { seed: 1, charge: 9999 }));
      if (comboId == null) return;
      // Something for it to shoot at while the clip watches, walked up to the edge of its reach.
      // Spaced rather than stacked: `spawnUnit`'s own `count` puts them all on the spawn tile at
      // once, which reads as a single unit for the whole clip.
      const ids = await releaseSpread(api, { count: 3 });
      if (ids.length) await skipToApproach(api, comboId, ids[0]);
    },

    async act(api) {
      const c0 = towerById(await snap(api), comboId);
      if (!c0) return; // no combo assembled; reported by the hard assertion below
      level0 = c0.level;
      dmg0 = c0.damage;
      range0 = c0.range;

      // The combo working at its landing level, so the climb has a visible starting point.
      await api.advance(BEFORE_TICKS);

      await api.call("upgradeCombo", comboId);
      c1 = towerById(await snap(api), comboId);

      // The assertions are already fixed on `c1`; this only lets the clip show the upgraded
      // tower working.
      await api.advance(AFTER_TICKS);
    },

    async assert(api, check) {
      // Hard: every reading below is a property OF the assembled tower and a comparison across
      // its upgrade, so a board that assembled none has nothing to grade. Stopping here records a
      // clean failed verdict on the claim that actually broke, rather than dereferencing a missing
      // tower and reporting a debug-API contract failure the build did not commit.
      check.assertOk("a combination tower was assembled to upgrade", comboId != null && c1 != null);
      check.expectEq("the combo starts at its landing level 0", level0, 0);
      check.expectEq("upgrading raised the combo's level", c1.level, level0 + 1);
      check.expectGt("...scaling its damage up", c1.damage, dmg0);
      check.expectGe("...and not decreasing its range", c1.range, range0);
    },
  };
}
