// Automated validation for the Stages sub-item `advance`.
//
// Destroying the whole formation clears the wave and advances to the next stage. A
// single formation drone is posed (once assembled, the real stage-end check fires
// when the field empties); a matching shot clears it, the wave ends, and the real
// progression advances the stage.

import { startStageClean, spawnDrone, shootDrone } from "../_helpers.mjs";

export default function item() {
  // The drone whose death ends the wave, and the two progression milestones.
  let shardId;
  let cleared;
  let next;

  return {
    id: "stages.advance",

    // A stage-1 wave emptied down to a single posed drone, so "the whole formation
    // destroyed" is one shot away and the stage-end path can be reached quickly.
    async arrange(api) {
      await startStageClean(api, 1);
      shardId = await spawnDrone(api, {
        kind: "shard",
        band: "cyan",
        x: 640,
        y: 200,
        phase: "formation",
      });
    },

    async act(api) {
      await api.advance(12); // 12 ticks = the old 0.1 s: the formation registers as assembled (arms stage-end)

      await shootDrone(api, shardId, "cyan");
      cleared = await api.until((s) => s.screen === "stageCleared", {
        max: 240,
      }); // 240 ticks = the old 2 s

      // The interstitial then advances to the next stage.
      next = await api.until((s) => s.stage === 2, { max: 480 }); // 480 ticks = the old 4 s
    },

    async assert(api, check) {
      check.expectOk("clearing the formation clears the wave", cleared.hit);
      check.expectEq(
        "the stage has not yet incremented at the interstitial",
        cleared.snap.stage,
        1,
      );
      check.expectOk("the cleared wave advances to the next stage", next.hit);
    },
  };
}
