// Automated validation for the Hunter item `fair-reset-death`.
//
// After a DEATH ends the crossing, the bear is removed and does not re-emerge onto
// the just-respawned critter — only once the fresh critter has advanced a few tiles.
// A death is driven (drowning), the fresh crossing is confirmed bear-free, the bear
// stays away while the critter idles, and returns once it advances. The matching
// reset after a completed crossing is `fair-reset-bay`. See validation/_helpers.mjs.

// HOW THE DEATH IS STAGED, AND WHY IT IS NOT A DROWNING ANY MORE. The item used to
// stand the critter on open water, which kills it on the first tick of `act` — so the
// recording opened on a death that had already happened. A reviewer saw a critter
// missing from a board they never saw it on, and the fairness rule the item is actually
// about played out afterwards with no visible cause. The death is now a RIDE off the
// side edge (specs/water.md): the critter is posed aboard a floe a few tiles short of
// the boundary, so the clip opens on it riding, shows it carried out past the edge, and
// only then shows the reset. Nothing about the rule under test changes — the sweeps that
// follow are untouched, and specs/hunter.md makes the reset the same "when a crossing
// ends" whatever ended it, so any death serves. This one can be watched.

import { actUntilDeath, startCrossing } from "../_helpers.mjs";

// The ride off the edge: a floe a few tiles short of the right boundary, drifting out at
// a lane speed the water band actually uses (specs/water.md spans 3.0–4.2 tiles/second).
// Five tiles at 3.5 is about a second and a half of visible drift before the edge.
const EDGE_ROW = 5;
const START_COL = 34;
const DRIFT_SPEED = 3.5;

export default function item() {
  // The three sweeps: the fresh crossing after the death, the idle period, and the
  // return once the critter advances.
  let r;
  let idle;
  let back;

  return {
    id: "hunter.fair-reset-death",

    // Pose a death that ends the crossing: the critter aboard a floe drifting out toward
    // the side edge, with lives to spare so the run continues into a respawn rather than
    // a game over.
    async arrange(api) {
      await startCrossing(api);
      await api.call("setLives", 3);
      // The pursuit is suspended. What this item reads is entirely about a bear being
      // PRESENT or not — removed when the crossing ends, absent while the fresh critter
      // idles, back once it advances — and none of that is the pursuit, which
      // specs/instrumentation.md leaves the rest of a bear's life running without. With
      // the brain on, a bear that re-emerges during these sweeps can reach the critter and
      // catch it, which starts yet another crossing and removes it again: the fairness
      // rule would then be judged on a board that had moved on twice while it was being
      // read. Frozen, every reading is of the bear this item posed.
      await api.call("setBearAI", false);
      await api.call("setLane", EDGE_ROW, {
        cols: [START_COL],
        speed: DRIFT_SPEED,
        dir: 1,
      }); // a floe drifting out past the right edge
      await api.call("placeCritter", START_COL, EDGE_ROW);
    },

    // The death, the empty respawn, the bear staying away while the critter idles, and
    // its return once the critter advances — the whole fairness rule, in order. The
    // re-pose partway through is control ops only (`setLane` / `placeCritter`), never
    // `startCrossing`, whose reset would freeze the recording.
    async act(api) {
      // Ride out to the edge and die there. The death is waited on as the life it costs
      // rather than as a `dying` phase: this sweep exists only to get past the death so
      // the fairness rule can be watched, and nothing downstream is about the sub-phase,
      // so it should key on the fact that cannot be missed between two samples. The
      // budget covers the whole drift out to the edge, not just the death at the end.
      await actUntilDeath(api, 3, { max: 360 }); // 3 s — the drift out plus the death
      r = await api.until(
        (s) => s.phase === "crossing" && s.critter.row === 19,
        {
          max: 240, // 2 s
          poll: 6, // 0.05 s
        },
      );

      // With the critter idle, the bear does not re-emerge.
      idle = await api.until((s) => s.bears[0].present, { max: 120, poll: 6 }); // 1 s

      // Once the critter advances, the bear returns. The window is generous for the
      // reason in `hunter/emerges.mjs`: specs/hunter.md pins no re-emerge delay, so
      // sizing this to one build's constant would fail another equally correct build.
      // The `idle` sweep above is what holds the fairness rule; this one only has to
      // establish that the bear does come back.
      await api.call("setLane", 15, { cols: [] });
      await api.call("placeCritter", 20, 15);
      back = await api.until((s) => s.bears[0].present, { max: 600, poll: 6 }); // 5 s
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
