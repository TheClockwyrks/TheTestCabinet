// Automated validation for quality.range-and-firerate: range nudges up a little per tier
// (about 8 px per rung) while fire rate is flat across quality.
//
// One capacitor candidate is placed at each tier; each candidate's derived range must equal
// base + 8*(tier-1), and its fire rate must be the flat base value for every tier.
//
// Only the opening of the run is arranged; landing the five tiers side by side is the behavior
// under test, and a placement is a control op, so the ladder is built in the act — which also
// gives the reviewer a capture of five range rings widening by one rung each.

import { startBuild, placeCandidate, SPOTS, BASE, RANGE_PER_TIER, towerAt, snap } from "../_helpers.mjs";

// A frame for the still, so the capture shows all five tiers standing. 100 ms = 6 ticks.
const SETTLE_TICKS = 6;

export default function item() {
  // The board with the five tiers on it, read by `assert`.
  let s;

  return {
    id: "quality.range-and-firerate",

    async arrange(api) {
      await startBuild(api);
    },

    async act(api) {
      for (let tier = 1; tier <= 5; tier += 1) {
        await placeCandidate(api, "capacitor", tier, SPOTS[tier - 1].col, SPOTS[tier - 1].row);
      }
      s = await snap(api);

      await api.advance(SETTLE_TICKS);
      await api.screenshot("rangerate");
    },

    async assert(api, check) {
      for (let tier = 1; tier <= 5; tier += 1) {
        const t = towerAt(s, SPOTS[tier - 1].col, SPOTS[tier - 1].row);
        check.expectEq(`capacitor T${tier} range (base + 8/tier)`, t.range, BASE.capacitor.range + RANGE_PER_TIER * (tier - 1));
        check.expectClose(`capacitor T${tier} fire rate is flat`, t.fireRate, BASE.capacitor.fireRate, 1e-6);
      }
    },
  };
}
