// Cargo: a package dropped off a track rests on the ground, persists, and can be picked
// back up. The worker drops on plain ground, waits (no train), then retrieves it.

import { actPressStep, setTile, startFresh } from "../_helpers.mjs";

export default function item() {
  // The snapshot after the drop, the ground count after time passed, and the snapshot
  // after picking it back up.
  let dropped;
  let groundAfterWait;
  let retrieved;

  return {
    id: "cargo.drop-safe",

    // Pose the worker on plain ground (no track) holding one package.
    async arrange(api) {
      await startFresh(api, 1);
      await setTile(api, 10, 12);
      await api.call("givePackage", {
        color: "red",
        weightClass: "parcel",
        archetype: "dispenser",
      });
    },

    // Drop, let time pass with no train, then pick it back up. All three beats are the
    // behavior under test and all three are filmed.
    async act(api) {
      dropped = await actPressStep(api, "KeyQ");

      // 60 ticks = the old 1.0s. Time passes off-track — the package must persist.
      await api.advance(60);
      groundAfterWait = (await api.snapshot()).ground.length;

      retrieved = await actPressStep(api, "KeyE");

      // Hold on the retrieved state for the clip. 30 ticks = the old 500ms clip hold.
      await api.advance(30);
    },

    async assert(api, check) {
      check.expectEq(
        "the dropped package rests on the ground",
        dropped.ground.length,
        1,
      );
      check.expectEq(
        "it left the carried set",
        dropped.worker.carried.length,
        0,
      );
      check.expectEq("the off-track package persists", groundAfterWait, 1);
      check.expectEq(
        "the package can be picked back up",
        retrieved.worker.carried.length,
        1,
      );
      check.expectEq("the ground is clear again", retrieved.ground.length, 0);
    },
  };
}
