// Automated validation for the Progression item `levels`.
//
// Clearing a level advances to the next, which runs faster than the last. Four bays
// are pre-filled and the fifth cleared by a real hop; the real level logic advances
// the level and rebuilds it faster, which the snapshots read back. See
// validation/_helpers.mjs.

import { startCrossing, WATER_TOP } from "../_helpers.mjs";

export default function item() {
  // The level-1 lane speed, read instantly before the clear (afterwards the level has
  // been rebuilt), and the sweep that waited for level 2.
  let l1speed;
  let r;

  return {
    id: "progression.levels",

    // Pose the last-bay-open board, with the level-1 speed noted first so the rebuild
    // can be compared against it.
    async arrange(api) {
      await startCrossing(api);
      l1speed = (await api.snapshot()).lanes.ice[0].speed;
      await api.call("setBays", [true, true, true, true, false]);
      await api.call("setLane", WATER_TOP, { cols: [35], speed: 0 });
      await api.call("placeCritter", 35, WATER_TOP);
    },

    // The clearing hop and the faster next level that follows — what is checked, and
    // the clip.
    async act(api) {
      await api.call("press", "ArrowUp"); // fill the fifth bay -> clear the level
      await api.advance(18); // 0.15 s, just past the hop cooldown, so the hop lands
      // The clear runs through a between-levels pause, so sweep for the new level:
      // 2.5 s at a 0.1 s cadence.
      r = await api.until((s) => s.level === 2, { max: 300, poll: 12 });
    },

    async assert(api, check) {
      check.expectOk("clearing a level advances to the next", r.hit);
      check.expectEq("the level is now 2", r.snap.level, 2);
      check.expectGt(
        "the next level runs faster",
        r.snap.lanes.ice[0].speed,
        l1speed,
      );
    },
  };
}
