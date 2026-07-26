// Cargo: dying on a track destroys EVERYTHING the worker was carrying in that same
// collision. The worker is posed on a lane carrying two packages; a train is spawned
// already overlapping it and one step kills it — the carried set is wiped.

import { setTile, startFresh } from "../_helpers.mjs";

export default function item() {
  // The carried count before the collision, and the snapshot the collision produced.
  let carriedBefore;
  let snap;

  return {
    id: "cargo.death-drop",

    // Pose the worker on the lane holding two packages. The train is spawned in `act`
    // rather than here so the clip opens on a worker standing on the track and then
    // shows the train arrive, instead of opening on the hit already resolved.
    async arrange(api) {
      await startFresh(api, 1);
      await setTile(api, 8, 10);
      await api.call("givePackage", {
        color: "red",
        weightClass: "parcel",
        archetype: "dispenser",
      });
      await api.call("givePackage", {
        color: "blue",
        weightClass: "parcel",
        archetype: "dispenser",
      });
      carriedBefore = (await api.snapshot()).worker.carried.length;
    },

    async act(api) {
      // A train already over the worker's lane position; a few ticks resolve the lethal
      // hit. 6 ticks = the old 0.1s.
      await api.call("spawnTrain", {
        line: 10,
        orientation: "horizontal",
        dir: "east",
        kind: "freight",
        headPos: 400,
      });
      await api.advance(6);
      snap = await api.snapshot();

      // Hold on the aftermath so the clip shows the death beat rather than cutting on
      // the frame of impact. 36 ticks = the old 600ms clip hold.
      await api.advance(36);
    },

    async assert(api, check) {
      check.expectEq("carrying two before the collision", carriedBefore, 2);
      check.expectEq(
        "the collision wiped the carried load",
        snap.worker.carried.length,
        0,
      );
      check.expectEq("the death cost a life", snap.level.lives, 2);
    },
  };
}
