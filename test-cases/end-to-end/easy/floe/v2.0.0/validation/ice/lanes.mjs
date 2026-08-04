// Automated validation for the Ice band item `lanes`.
//
// The ice band is eight solid lanes (rows 11..18), each carrying sliding
// multi-tile vehicles (a 3-tile plow, a 2-tile dogsled, a 2-tile car), moving in
// alternating directions. Read straight from the snapshot after a fresh crossing.
// See validation/_helpers.mjs.

// THE BAND IS FILMED, NOT PHOTOGRAPHED. What this item asserts is a shape that only
// motion makes legible: eight lanes whose directions ALTERNATE. A still frame shows
// eight rows of vehicles and says nothing about which way any of them is going, so a
// reviewer had no way to see the fact being scored. A few seconds of the band running
// shows every lane's direction at once, and the weave of opposing traffic is the thing
// the item is named for.

import { startCrossing, ICE_TOP } from "../_helpers.mjs";

// How long the band is filmed. Long enough for the slowest lane (1.5 tiles/second,
// specs/hazards.md) to carry a vehicle several tiles, so its direction is unmistakable.
const RUN_TICKS = 420; // 3.5 s

export default function item() {
  // The ice band as posed, read instantly — the item checks the band's shape, which
  // is settled the moment the level is built and does not depend on time passing.
  let ice;

  return {
    id: "ice.lanes",

    async arrange(api) {
      await startCrossing(api);
      ice = (await api.snapshot()).lanes.ice;
    },

    // Nothing has to happen for the check; the clip's job is to show the band the
    // assertions describe, running, so the alternating directions can be read off it.
    async act(api) {
      await api.advance(RUN_TICKS);
    },

    async assert(api, check) {
      check.expectEq("eight ice-band lanes", ice.length, 8);
      for (let i = 0; i < ice.length; i += 1) {
        check.expectEq(
          `ice lane ${i} is at row ${ICE_TOP + i}`,
          ice[i].row,
          ICE_TOP + i,
        );
        check.expectGt(
          `ice lane ${i} carries vehicles`,
          ice[i].items.length,
          0,
        );
      }

      // The three vehicle kinds are all present, at their native lengths.
      const items = ice.flatMap((l) => l.items);
      const byKind = {};
      for (const v of items) byKind[v.kind] = v.len;
      check.expectOk("a 3-tile plow is present", byKind.plow === 3);
      check.expectOk("a 2-tile dogsled is present", byKind.dogsled === 2);
      check.expectOk("a 2-tile car is present", byKind.car === 2);

      // Directions alternate lane to lane.
      for (let i = 1; i < ice.length; i += 1) {
        check.expectEq(
          `ice lane ${i} runs opposite lane ${i - 1}`,
          ice[i].dir,
          -ice[i - 1].dir,
        );
      }
    },
  };
}
