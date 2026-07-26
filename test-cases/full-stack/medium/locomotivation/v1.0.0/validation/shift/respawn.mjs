// Shift: a death respawns the worker at the spawn with empty hands, spends a life, and
// leaves already-banked deliveries intact. One red is banked as a precondition; the worker
// dies carrying a package, then respawns — the banked red persists, the carried load is gone.

import {
  setTile,
  startFresh,
  deliveredOf,
  tileCenterX,
  tileCenterY,
} from "../_helpers.mjs";

export default function item() {
  // The snapshot taken once the respawn beat had played out.
  let snap;

  return {
    id: "shift.respawn",

    // Bank one delivery, then pose the worker on the lane carrying another. The train is
    // spawned in `act` so the clip shows death and respawn rather than opening on the hit.
    async arrange(api) {
      await startFresh(api, 1);
      await api.call("setDelivered", "red", 1); // banked progress
      await setTile(api, 8, 10);
      await api.call("givePackage", {
        color: "red",
        weightClass: "parcel",
        archetype: "dispenser",
      });
    },

    async act(api) {
      await api.call("spawnTrain", {
        line: 10,
        orientation: "horizontal",
        dir: "east",
        kind: "freight",
        headPos: 400,
      });

      await api.advance(6); // 6 ticks = the old 0.1s — die
      await api.advance(72); // 72 ticks = the old 1.2s — the respawn beat
      snap = await api.snapshot();

      // Hold on the respawned worker so the clip ends on live play back at the spawn.
      // 36 ticks = the old 600ms clip hold.
      await api.advance(36);
    },

    async assert(api, check) {
      check.expectEq(
        "the worker is playing again after respawn",
        snap.phase,
        "playing",
      );
      check.expectClose(
        "respawned at the spawn (x)",
        snap.worker.x,
        tileCenterX(3),
        0.5,
      );
      check.expectClose(
        "respawned at the spawn (y)",
        snap.worker.y,
        tileCenterY(14),
        0.5,
      );
      check.expectEq(
        "respawns with empty hands",
        snap.worker.carried.length,
        0,
      );
      check.expectEq("a life was spent", snap.level.lives, 2);
      check.expectEq(
        "the banked delivery persisted",
        deliveredOf(snap, "red"),
        1,
      );
    },
  };
}
