// Automated validation for audio.thrust-loop: a jetpack thrust loop plays while the jetpack
// lifts the miner (src/audio.ts's "thrust" LoopCue, started via `game.activeLoops` in
// updateLoops — src/game.ts). Audio is read from the Web Audio sources the build starts (see
// `api.audio`). We open a shaft above a grounded, fully-fueled miner, arm audio, hold thrust,
// and read the audio log across the real climb (fuel.thrust-burns arranges the same shaft).

import {
  teleportInto,
  K,
  newRun,
  openColumn,
  solid,
  ROCKBED_ROW,
  SPAWN_COL,
  armAudio,
  audioCount,
  drainAudioQueue,
} from "../_helpers.mjs";

export default function item() {
  const col = SPAWN_COL;
  const row = ROCKBED_ROW;
  let before;
  let after;
  let snap;

  return {
    id: "audio.thrust-loop",

    // A full tank on a grounded miner with an open shaft above it to climb into.
    async arrange(api) {
      await newRun(api);
      await teleportInto(api, col, row);
      await openColumn(api, col, row - 4, row - 1); // open above so the miner can climb
      await solid(api, col, row + 1);
      await teleportInto(api, col, row);
      await api.call("setFuel", 999); // top off (clamped to max)
      await armAudio(api);
    },

    async act(api) {
      before = await audioCount(api);
      await api.call("keyDown", K.thrust);
      await api.advance(15); // 15 ticks = 0.25 s of real climb
      snap = (await api.snapshot()).miner;
      await drainAudioQueue(api);
      after = await audioCount(api);
      await api.advance(10); // a short tail so the clip shows the lift-off
      await api.call("keyUp", K.thrust);
    },

    async assert(api, check) {
      check.expectLt("thrust lifts the miner upward", snap.vy, 0);
      check.expectGt(
        "a thrust loop cue plays while climbing (Web Audio sources started)",
        after,
        before,
      );
    },
  };
}
