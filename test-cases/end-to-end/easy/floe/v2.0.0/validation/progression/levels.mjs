// Automated validation for the Progression item `levels`.
//
// Clearing a level advances to the next, which runs faster than the last. Four bays
// are pre-filled and the fifth cleared by a real hop; the real level logic advances
// the level and rebuilds it faster, which the snapshots read back. See
// validation/_helpers.mjs.

import { startCrossing, BAY_COL, WATER_TOP } from "../_helpers.mjs";

// The last bay, entered at the column its opening straddles under either reading
// of specs/playfield.md's bay layout (see `BAY_COL`).
const COL = BAY_COL[4];

// How long the clip runs BEFORE the clearing hop.
//
// The item's second half is that the next level runs faster, and "faster" is a
// comparison: a reviewer who never saw level 1 moving has nothing to compare level 2
// against. The clip used to open on the press, so level 1 existed on camera for the
// tenth of a second the hop took. This runs the level-1 board first, at its own pace,
// so the change of pace afterwards is something that can actually be judged.
const LEAD_TICKS = 180; // 1.5 s of level 1 before it is cleared

// How long the clip keeps filming once level 2 is up. The item's second half is that
// the new level runs FASTER, and a speed is not something a single frame can show —
// the sweep landed on the tick the level turned over, so the clip ended on a board
// that had barely begun to move. A few seconds of level 2 actually running is what
// lets a reviewer see the traffic and the floes going quicker than they did.
const TAIL_TICKS = 360; // 3 s

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
      await api.call("setLane", WATER_TOP, { cols: [COL], speed: 0 });
      await api.call("placeCritter", COL, WATER_TOP);
    },

    // The clearing hop and the faster next level that follows — what is checked, and
    // the clip.
    async act(api) {
      await api.advance(LEAD_TICKS); // camera only: level 1 running at level-1 speed
      await api.call("press", "ArrowUp"); // fill the fifth bay -> clear the level
      await api.advance(18); // 0.15 s, just past the hop cooldown, so the hop lands
      // The clear runs through a between-levels pause, so sweep for the new level:
      // 2.5 s at a 0.1 s cadence.
      r = await api.until((s) => s.level === 2, { max: 300, poll: 12 });
      await api.advance(TAIL_TICKS); // level 2 running, visibly quicker
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
