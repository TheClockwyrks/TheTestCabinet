// Automated validation for the Water band item `lanes`.
//
// The water band is eight lanes (rows 2..9) of drifting floes, in alternating
// directions. Read straight from the snapshot after a fresh crossing. See
// validation/_helpers.mjs.

import { startCrossing, WATER_TOP } from "../_helpers.mjs";

export default function item() {
  // The water band as posed — the item checks the band's shape, which is settled the
  // moment the level is built and does not depend on time passing.
  let water;

  return {
    id: "water.lanes",

    async arrange(api) {
      await startCrossing(api);
      water = (await api.snapshot()).lanes.water;
    },

    // Nothing has to happen for the check; the clip's job is to show the band the
    // assertions describe, so let it draw and capture it.
    async act(api) {
      // 0.12 s is 14.4 ticks, which the tick contract rejects rather than rounds. This
      // is a paint settle, so it rounds UP to 15 — never shorter than it was.
      await api.advance(15);
      await api.screenshot("scene");
    },

    async assert(api, check) {
      check.expectEq("eight water-band lanes", water.length, 8);
      for (let i = 0; i < water.length; i += 1) {
        check.expectEq(
          `water lane ${i} is at row ${WATER_TOP + i}`,
          water[i].row,
          WATER_TOP + i,
        );
        check.expectGt(
          `water lane ${i} carries floes`,
          water[i].items.length,
          0,
        );
      }
      for (let i = 1; i < water.length; i += 1) {
        check.expectEq(
          `water lane ${i} runs opposite lane ${i - 1}`,
          water[i].dir,
          -water[i - 1].dir,
        );
      }
    },
  };
}
