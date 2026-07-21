// Shift: dying while carrying a unique destroys it and fails the shift immediately, even
// with lives remaining. The worker carries a unique (precondition) with full lives; a real
// train kills it, and the lost unique fails the shift though a life was left.

import { setTile, startFresh } from "../_helpers.mjs";

export default function item() {
  // The snapshot the lethal hit produced.
  let snap;

  return {
    id: "shift.fail-unique-carry",

    // Pose the worker on the lane with full lives, carrying the unique. The train is
    // spawned in `act` so the clip shows the approach.
    async arrange(api) {
      await startFresh(api, 1);
      await api.call("setLives", 3);
      await setTile(api, 8, 10);
      await api.call("givePackage", {
        color: "red",
        weightClass: "load",
        archetype: "unique",
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

      await api.advance(6); // 6 ticks = the old 0.1s — the lethal hit destroys the carried unique
      snap = await api.snapshot();

      // Hold on the failure so the clip shows the shift-failed screen. 36 ticks = the old
      // 600ms clip hold.
      await api.advance(36);
    },

    async assert(api, check) {
      check.expectEq(
        "dying with the unique fails the shift",
        snap.screen,
        "level-failed",
      );
      check.expectEq(
        "the failure reason is a lost unique",
        snap.level.failReason,
        "unique-lost",
      );
      check.expectEq("it failed despite a life remaining", snap.level.lives, 2);
    },
  };
}
