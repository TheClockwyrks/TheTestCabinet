// Shift: a unique required package destroyed by a train fails the shift immediately,
// regardless of clock or lives. A unique is placed on the track (precondition) with the
// worker safely away; a real train smashes it and the real rule fails the shift.

import { setTile, startFresh } from "../_helpers.mjs";

export default function item() {
  // The snapshot once the unique had been smashed.
  let snap;

  return {
    id: "shift.fail-unique-track",

    // Leave the unique sitting on the track with the worker well clear of it, so the only
    // thing the train can hit is the cargo.
    async arrange(api) {
      await startFresh(api, 1);
      await setTile(api, 3, 14); // safely off the track
      await api.call("spawnGroundPackage", {
        col: 6,
        row: 8,
        color: "red",
        weightClass: "load",
        archetype: "unique",
      });
    },

    async act(api) {
      await api.call("spawnTrain", {
        line: 8,
        orientation: "horizontal",
        dir: "east",
        kind: "freight",
        headPos: 300,
      });

      await api.advance(12); // 12 ticks = the old 0.2s — the train smashes the unique
      snap = await api.snapshot();

      // Hold on the failure for the clip. 36 ticks = the old 600ms clip hold.
      await api.advance(36);
    },

    async assert(api, check) {
      check.expectEq(
        "losing a unique fails the shift",
        snap.screen,
        "level-failed",
      );
      check.expectEq(
        "the failure reason is a lost unique",
        snap.level.failReason,
        "unique-lost",
      );
    },
  };
}
