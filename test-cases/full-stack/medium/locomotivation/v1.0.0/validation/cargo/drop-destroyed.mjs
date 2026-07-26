// Cargo: a package left ON a track is destroyed by the next train that passes over it.
// The worker drops on the row-8 track, then steps clear to safe ground; a real train is
// spawned on that lane and advanced until it passes over the package.

import { actPressStep, setTile, startFresh } from "../_helpers.mjs";

export default function item() {
  // The ground after the drop, and the ground after the train has run over it.
  let afterDrop;
  let afterTrain;

  return {
    id: "cargo.drop-destroyed",

    // Pose the worker standing on the track holding the package it is about to leave there.
    async arrange(api) {
      await startFresh(api, 1);
      await setTile(api, 5, 8); // on the track
      await api.call("givePackage", {
        color: "red",
        weightClass: "parcel",
        archetype: "dispenser",
      });
    },

    // Drop on the track, step clear, and let a real train run the length of the lane.
    // The whole sequence is filmed, so the clip shows the abandoned package and the
    // train that destroys it.
    async act(api) {
      afterDrop = await actPressStep(api, "KeyQ");

      await setTile(api, 5, 11); // step clear so only the cargo is under the train
      await api.call("spawnTrain", {
        line: 8,
        orientation: "horizontal",
        dir: "east",
        kind: "freight",
        headPos: 0,
      });
      await api.advance(210); // 210 ticks = the old 3.5s, running the real train over the package
      afterTrain = await api.snapshot();
    },

    async assert(api, check) {
      check.expectEq(
        "the package is resting on the track",
        afterDrop.ground.length,
        1,
      );
      check.expectEq(
        "the train smashed the on-track cargo",
        afterTrain.ground.length,
        0,
      );
    },
  };
}
