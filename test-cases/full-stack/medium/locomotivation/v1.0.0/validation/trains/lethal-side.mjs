// Trains: contact with the FLANK of a passing car — not only its leading edge — is lethal.
// The worker is posed under a mid-body car (the head is already well past it), so the only
// contact is a side one; a single step resolves the lethal overlap.

import { setTile, startFresh } from "../_helpers.mjs";

export default function item() {
  // The snapshot the flank contact produced.
  let snap;

  return {
    id: "trains.lethal-side",

    // Pose the worker on the lane. The train is spawned in `act` with its head already
    // past the worker, so the only contact possible is a side one.
    async arrange(api) {
      await startFresh(api, 1);
      await setTile(api, 8, 10); // worker at x=340 on the lane
    },

    async act(api) {
      // headPos 400 puts the leading edge past the worker, so the worker sits under a mid car flank.
      await api.call("spawnTrain", {
        line: 10,
        orientation: "horizontal",
        dir: "east",
        kind: "freight",
        headPos: 400,
      });

      await api.advance(6); // 6 ticks = the old 0.1s
      snap = await api.snapshot();

      // Hold on the death beat for the clip. 36 ticks = the old 600ms clip hold.
      await api.advance(36);
    },

    async assert(api, check) {
      check.expectEq("a flank contact killed the worker", snap.level.lives, 2);
      check.expectOk(
        "the worker is in the death/respawn beat",
        ["dying", "respawning"].includes(snap.phase),
      );
    },
  };
}
