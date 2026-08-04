// Automated validation for the Water band item `drown`.
//
// Standing on a water tile with no floe under it is death. The bottom water lane is
// cleared to open water and the critter hops off the median into it; the real
// simulation drowns it, which the snapshot reads back. See validation/_helpers.mjs.
//
// THE CRITTER HOPS IN RATHER THAN BEING PARKED IN. Posed straight onto the open
// water it drowned on the first step of `act`, so the clip was a second of a critter
// standing on the sea and then a cut — no hop, no fall, no splash, and nothing that
// reads as "this tile killed it" rather than "this build draws the critter in odd
// places". Hopping off solid ground into the gap shows the death being CAUSED, and
// the clip then holds long enough to catch the splash and the fresh critter coming
// back on the near shore.

// THE FOOTING OVER OPEN WATER IS NOT READ HERE, and the item is not weaker for it.
// It used to be: the critter was posed on the cleared tile, `footing` read straight
// off that placement, and the critter put back on the median. But footing is a
// STEPPED reading (see `actFooting`) — specs/instrumentation.md hands `placeCritter`
// to the simulation that follows it — and this is the one tile where the reading
// cannot be taken after a step, because the step that would compute it is the step
// that drowns the critter ("a state the critter cannot survive past the next step").
// So the pre-step read failed builds that derive footing in their tick, over a
// snapshot field, while the rule this item scores — that open water is death — passed
// on the same run. What is left is exactly that rule, which is what the item is.

import {
  actUntilDeath,
  startCrossing,
  ROW_MEDIAN,
  WATER_BOTTOM,
} from "../_helpers.mjs";

// The column the critter hops in at, the lives it starts with (so the loss reads as a
// decrement), how long it is filmed standing safely on the median first, and how long
// the clip keeps filming after the drowning — enough to cover the death and the respawn
// that follows it. The lead-in is what makes the hop read as a hop: without it the clip
// opens on the press itself, and a reviewer never sees the solid tile the critter left.
const COL = 20;
const LIVES = 3;
const LEAD_TICKS = 60; // 0.5 s
const TAIL_TICKS = 240; // 2 s

export default function item() {
  // The sweep that waited for the drowning.
  let r;

  return {
    id: "water.drown",

    // Pose the drowning: the bottom water lane cleared to open water with the critter
    // on the median right below it, and three lives so the loss reads as a decrement.
    async arrange(api) {
      await startCrossing(api);
      await api.call("setLives", LIVES);
      await api.call("setLane", WATER_BOTTOM, { cols: [] }); // open water, no floe
      await api.call("placeCritter", COL, ROW_MEDIAN); // on solid ground, below the gap
    },

    // The hop off the median into open water, the drowning, and the respawn after it
    // — what is checked, and the clip.
    async act(api) {
      await api.advance(LEAD_TICKS); // the critter safe on the median, floes drifting
      await api.call("press", "ArrowUp"); // off the median into the cleared lane
      r = await actUntilDeath(api, LIVES, { max: 120, poll: 2 }); // 1 s
      await api.advance(TAIL_TICKS);
    },

    async assert(api, check) {
      check.expectOk("hopping onto open water drowns the critter", r.hit);
      check.expectEq("a life is lost to drowning", r.snap.lives, LIVES - 1);
    },
  };
}
