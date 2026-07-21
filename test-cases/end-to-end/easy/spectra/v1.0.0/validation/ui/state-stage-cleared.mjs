// Automated validation for the UI sub-item `state-stage-cleared`: the stage-cleared
// interstitial is reachable, and captured for the reviewer.
//
// A single formation drone is posed and destroyed with a matching shot; clearing
// the field ends the wave through the real stage-end path, landing on the
// stage-cleared interstitial, which is read back and captured.

import { startStageClean, spawnDrone, shootDrone } from "../_helpers.mjs";

export default function item() {
  // The drone whose death ends the wave, and the moment the interstitial appeared.
  let shardId;
  let r;

  return {
    id: "ui.state-stage-cleared",

    // A stage-1 wave emptied down to one posed drone, so the stage-end path is one
    // shot away.
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
      await api.advance(12); // 12 ticks = the old 0.1 s: arm the stage-end check
      await shootDrone(api, shardId, "cyan");
      r = await api.until((s) => s.screen === "stageCleared", { max: 240 }); // 240 ticks = the old 2 s

      // A real pause so the interstitial has been painted before it is captured.
      await api.settle(120);
      await api.screenshot("cleared");
    },

    async assert(api, check) {
      check.expectOk(
        "clearing the wave reaches the stage-cleared screen",
        r.hit,
      );
    },
  };
}
