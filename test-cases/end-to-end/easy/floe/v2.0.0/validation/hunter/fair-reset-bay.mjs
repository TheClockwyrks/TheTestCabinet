// Automated validation for the Hunter item `fair-reset-bay`.
//
// After a crossing is COMPLETED into a bay, the bear is removed and does not
// re-emerge onto the just-respawned critter — only once the fresh critter has
// advanced a few tiles. A bear is posed, the critter is hopped into an open bay to
// end the crossing, the fresh crossing is confirmed bear-free, the bear stays away
// while the critter idles, and returns once it advances. The matching reset after a
// death is `fair-reset-death`. See validation/_helpers.mjs.

import { startCrossing, ROW_MEDIAN, WATER_TOP } from "../_helpers.mjs";

// Bay index 2 spans cols 19,20 (specs/playfield.md); hopping up from col 20 in the
// top water row enters it.
const BAY_COL = 20;
const BAY_INDEX = 2;

export default function item() {
  // The bay fill that ends the crossing, the fresh crossing after it, the idle
  // period, and the bear's return once the critter advances.
  let filled;
  let r;
  let idle;
  let back;

  return {
    id: "hunter.fair-reset-bay",

    // Pose a crossing one hop from completion: the critter on a parked floe in the top
    // water row directly below an open bay, a bear already on the strait (so its removal
    // is observable), and lives to spare.
    async arrange(api) {
      await startCrossing(api);
      await api.call("setLives", 3);
      await api.call("setLane", WATER_TOP, { cols: [BAY_COL], speed: 0 }); // floe under the bay
      await api.call("placeCritter", BAY_COL, WATER_TOP);
      await api.call("setBear", 0, { col: BAY_COL, row: ROW_MEDIAN }); // a live bear to be removed
    },

    // Hop into the bay to complete the crossing, then watch the whole fairness rule:
    // the empty respawn, the bear staying away while the critter idles, and its return
    // once the critter advances. The re-pose partway through is control ops only
    // (`setLane` / `placeCritter`), never `startCrossing`, whose reset would freeze the
    // recording.
    async act(api) {
      await api.call("press", "ArrowUp");
      filled = await api.until((s) => s.bays[BAY_INDEX] === true, {
        max: 60,
        poll: 1,
      });
      r = await api.until(
        (s) => s.phase === "crossing" && s.critter.row === 19,
        { max: 180, poll: 6 }, // 1.5 s — covers the brief bay-fill pause
      );

      // With the critter idle, the bear does not re-emerge.
      idle = await api.until((s) => s.bears[0].present, { max: 120, poll: 6 }); // 1 s

      // Once the critter advances, the bear returns.
      await api.call("setLane", 15, { cols: [] });
      await api.call("placeCritter", 20, 15);
      back = await api.until((s) => s.bears[0].present, { max: 144, poll: 6 }); // 1.2 s
    },

    async assert(api, check) {
      check.expectOk("the crossing completes into a bay", filled.hit);
      check.expectOk("a fresh crossing begins after the bay", r.hit);
      check.expectEq(
        "no bear sitting on the just-respawned critter",
        r.snap.bears[0].present,
        false,
      );
      check.expectOk("the bear waits until the critter advances", !idle.hit);
      check.expectOk(
        "the bear re-emerges once the fresh critter advances",
        back.hit,
      );
    },
  };
}
