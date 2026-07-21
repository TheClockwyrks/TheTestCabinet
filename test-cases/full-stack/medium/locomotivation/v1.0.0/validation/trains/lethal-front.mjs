// Trains: a worker on the lane struck by an oncoming train's leading edge is killed. The
// worker is posed on a lane and a train approaches from the entry edge; the real train
// advance and lethal-overlap code kill it when the FRONT arrives.

import { setTile, startFresh } from "../_helpers.mjs";

export default function item() {
  // The lives before the train arrives, and the snapshot after it did.
  let livesBefore;
  let snap;

  return {
    id: "trains.lethal-front",

    // Pose the worker on the lane with full lives. The train is spawned in `act` so the
    // clip shows its whole approach — which is the point of a FRONT-contact check.
    async arrange(api) {
      await startFresh(api, 1);
      await setTile(api, 8, 10);
      livesBefore = (await api.snapshot()).level.lives;
    },

    async act(api) {
      await api.call("spawnTrain", {
        line: 10,
        orientation: "horizontal",
        dir: "east",
        kind: "freight",
        headPos: 0,
      });

      // 234 ticks = the old 3.9s: the front reaches the worker (~3.6 s) within the death beat.
      await api.advance(234);
      snap = await api.snapshot();

      // Hold on the death beat for the clip. 42 ticks = the old 700ms clip hold.
      await api.advance(42);
    },

    async assert(api, check) {
      check.expectEq("full lives before the train arrives", livesBefore, 3);
      check.expectEq(
        "the train front killed the worker (a life spent)",
        snap.level.lives,
        2,
      );
      check.expectOk(
        "the worker is in the death/respawn beat",
        ["dying", "respawning"].includes(snap.phase),
      );
    },
  };
}
