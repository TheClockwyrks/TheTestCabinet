// Automated validation for the Audio item `kill`: a cue plays when a matching shot
// destroys a drone. Audio is read from the Web Audio sources the build starts (see
// `api.audio`). A single formation Shard is posed; a matching-band shot destroys
// it, and the audio log must grow across the kill.

import {
  startClean,
  armAudio,
  actAudioCount,
  spawnDrone,
  shootDrone,
  findDrone,
} from "../_helpers.mjs";

export default function item() {
  let before;
  let after;
  let killed;
  let shardId;

  return {
    id: "audio.kill",

    async arrange(api) {
      await startClean(api);
      shardId = await spawnDrone(api, {
        kind: "shard",
        band: "cyan",
        x: 640,
        y: 300,
        phase: "formation",
      });
      await armAudio(api);
    },

    async act(api) {
      before = await actAudioCount(api);
      await shootDrone(api, shardId, "cyan"); // matching band
      const r = await api.until((s) => findDrone(s, shardId) === null, {
        max: 60, // 60 ticks = 0.5 s
      });
      after = await actAudioCount(api);
      killed = r.hit;
      await api.advance(30); // a short tail so the clip shows the kill
    },

    async assert(api, check) {
      check.expectOk("a matching-band shot destroys the drone", killed);
      check.expectGt(
        "a kill cue plays (Web Audio sources started)",
        after,
        before,
      );
    },
  };
}
