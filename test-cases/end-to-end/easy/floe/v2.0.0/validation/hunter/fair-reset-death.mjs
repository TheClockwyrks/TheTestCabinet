// Automated validation for the Hunter item `fair-reset-death`.
//
// After a DEATH ends the crossing, the bear is removed and does not re-emerge onto
// the just-respawned critter — only once the fresh critter has advanced a few tiles.
// A death is driven (drowning), the fresh crossing is confirmed bear-free, the bear
// stays away while the critter idles, and returns once it advances. The matching
// reset after a completed crossing is `fair-reset-bay`. See validation/_helpers.mjs.

import { startCrossing } from "../_helpers.mjs";

export default function item() {
  // The three sweeps: the fresh crossing after the death, the idle period, and the
  // return once the critter advances.
  let r;
  let idle;
  let back;

  return {
    id: "hunter.fair-reset-death",

    // Pose a death that ends the crossing: the critter standing over open water, with
    // lives to spare so the run continues into a respawn rather than a game over.
    async arrange(api) {
      await startCrossing(api);
      await api.call("setLives", 3);
      await api.call("setLane", 5, { cols: [] }); // open water -> drown to end the crossing
      await api.call("placeCritter", 20, 5);
    },

    // The death, the empty respawn, the bear staying away while the critter idles, and
    // its return once the critter advances — the whole fairness rule, in order. The
    // re-pose partway through is control ops only (`setLane` / `placeCritter`), never
    // `startCrossing`, whose reset would freeze the recording.
    async act(api) {
      await api.until((s) => s.phase === "dying", { max: 120 }); // 1 s
      r = await api.until(
        (s) => s.phase === "crossing" && s.critter.row === 19,
        {
          max: 240, // 2 s
          poll: 6, // 0.05 s
        },
      );

      // With the critter idle, the bear does not re-emerge.
      idle = await api.until((s) => s.bears[0].present, { max: 120, poll: 6 }); // 1 s

      // Once the critter advances, the bear returns.
      await api.call("setLane", 15, { cols: [] });
      await api.call("placeCritter", 20, 15);
      back = await api.until((s) => s.bears[0].present, { max: 144, poll: 6 }); // 1.2 s
    },

    async assert(api, check) {
      check.expectOk("a fresh crossing begins after the death", r.hit);
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
