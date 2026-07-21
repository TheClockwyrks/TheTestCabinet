// Cargo: the worker can carry several packages at once, up to the weight cap. Three
// parcels (90 of 120) are placed in reach and picked up for real, one E press each.

import { actPressStep, setTile, startFresh, W_MAX } from "../_helpers.mjs";

export default function item() {
  // The snapshot after the third pickup.
  let snap;

  return {
    id: "cargo.multi-carry",

    // Scatter three parcels within reach of the worker.
    async arrange(api) {
      await startFresh(api, 1);
      await setTile(api, 10, 12);
      for (const col of [10, 11, 9]) {
        await api.call("spawnGroundPackage", {
          col,
          row: 12,
          color: "green",
          weightClass: "parcel",
          archetype: "optional",
        });
      }
    },

    // Three real E presses, each resolving its own pickup edge. The clip shows the
    // parcels being gathered one by one.
    async act(api) {
      await actPressStep(api, "KeyE");
      await actPressStep(api, "KeyE");
      snap = await actPressStep(api, "KeyE");

      // Hold on the loaded worker so the clip does not cut on the third pickup frame.
      // 36 ticks = the old 600ms clip hold.
      await api.advance(36);
    },

    async assert(api, check) {
      check.expectEq(
        "all three parcels are carried at once",
        snap.worker.carried.length,
        3,
      );
      check.expectLe(
        "the carried load is within the cap",
        snap.worker.load,
        W_MAX,
      );
      check.expectEq("every parcel left the ground", snap.ground.length, 0);
    },
  };
}
