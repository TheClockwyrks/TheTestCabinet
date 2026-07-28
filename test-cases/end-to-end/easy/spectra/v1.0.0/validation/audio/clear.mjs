// Automated validation for the Audio item `clear`: a cue plays when a stage
// clears. Audio is read from the Web Audio sources the build starts (see
// `api.audio`). A stage-1 wave is emptied down to a single posed drone; a
// matching shot clears the whole formation, and the audio log must grow across
// the real stage-end (see `stages.advance`, the same drive).

import {
  startStageClean,
  armAudio,
  actAudioCount,
  spawnDrone,
  shootDrone,
} from "../_helpers.mjs";

export default function item() {
  let before;
  let after;
  let cleared;
  let shardId;

  return {
    id: "audio.clear",

    // A stage-1 wave emptied down to a single posed drone, so "the whole
    // formation destroyed" is one shot away.
    async arrange(api) {
      await startStageClean(api, 1);
      shardId = await spawnDrone(api, {
        kind: "shard",
        band: "cyan",
        x: 640,
        y: 200,
        phase: "formation",
      });
      await armAudio(api);
    },

    async act(api) {
      await api.advance(12); // 12 ticks = 0.1 s: the formation registers as assembled

      before = await actAudioCount(api);
      await shootDrone(api, shardId, "cyan"); // matching band
      const r = await api.until((s) => s.screen === "stageCleared", {
        max: 240, // 240 ticks = 2 s
      });
      after = await actAudioCount(api);
      cleared = r.hit;
      await api.advance(30); // a short tail so the clip shows the interstitial
    },

    async assert(api, check) {
      check.expectOk("clearing the formation clears the wave", cleared);
      check.expectGt(
        "a clear cue plays (Web Audio sources started)",
        after,
        before,
      );
    },
  };
}
