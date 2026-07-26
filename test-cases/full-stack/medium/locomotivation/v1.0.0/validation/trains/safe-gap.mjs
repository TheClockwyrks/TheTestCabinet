// Trains: the gap tile between two adjacent parallel tracks is safe. Level 2 has track
// rows 7 and 9 with a safe row-8 gap between them; a worker waiting there survives trains
// passing on either lane (both the scheduled service and a spawned freight).

import { setTile, startFresh } from "../_helpers.mjs";

export default function item() {
  // The snapshot once the trains had passed.
  let snap;

  return {
    id: "trains.safe-gap",

    // Pose the worker in the safe gap. The trains are spawned in `act` so the clip shows
    // them bearing down on the worker and passing either side of it.
    async arrange(api) {
      await startFresh(api, 2);
      await setTile(api, 10, 8); // the safe gap between rows 7 and 9
    },

    async act(api) {
      await api.call("spawnTrain", {
        line: 7,
        orientation: "horizontal",
        dir: "east",
        kind: "freight",
        headPos: 0,
      });
      await api.call("spawnTrain", {
        line: 9,
        orientation: "horizontal",
        dir: "west",
        kind: "freight",
        headPos: 0,
      });

      // 480 ticks = the old 8.0s, letting the trains (and the scheduled service) pass
      // right over the worker's column.
      await api.advance(480);
      snap = await api.snapshot();
    },

    async assert(api, check) {
      check.expectEq(
        "the worker survived in the gap (no life lost)",
        snap.level.lives,
        3,
      );
      check.expectEq("the shift is still live", snap.phase, "playing");
      check.expectEq(
        "the worker held its ground in the gap row",
        Math.floor((snap.worker.y - 80) / 40),
        8,
      );
    },
  };
}
