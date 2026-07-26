// Automated validation for quality.damage-scales: a component's damage multiplies
// x1 / x3 / x9 / x40 / x110 over Scrap across the five tiers — quality is the power axis.
//
// One capacitor candidate is placed at each tier; each candidate reports its derived damage,
// which must equal the base (Scrap) damage times the tier multiplier.
//
// Only the opening of the run is arranged; landing the five tiers side by side is the behavior
// under test, and a placement is a control op, so the ladder is built in the act and is what
// the clip shows.

import { startBuild, placeCandidate, SPOTS, BASE, QUALITY_MULT, towerAt, snap } from "../_helpers.mjs";

// A frame for the still, so the capture shows all five tiers standing. 100 ms = 6 ticks.
const SETTLE_TICKS = 6;

export default function item() {
  // The board with the five tiers on it, read by `assert`.
  let s;

  return {
    id: "quality.damage-scales",

    async arrange(api) {
      await startBuild(api);
    },

    async act(api) {
      for (let tier = 1; tier <= 5; tier += 1) {
        await placeCandidate(api, "capacitor", tier, SPOTS[tier - 1].col, SPOTS[tier - 1].row);
      }
      s = await snap(api);

      await api.advance(SETTLE_TICKS);
      await api.screenshot("damage");
    },

    async assert(api, check) {
      for (let tier = 1; tier <= 5; tier += 1) {
        const t = towerAt(s, SPOTS[tier - 1].col, SPOTS[tier - 1].row);
        const expected = Math.round(BASE.capacitor.dmg * QUALITY_MULT[tier]);
        check.expectEq(`capacitor T${tier} damage (x${QUALITY_MULT[tier]} over Scrap)`, t.damage, expected);
      }
    },
  };
}
