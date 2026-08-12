// Automated validation for audio.death-cue: a death cue plays the instant the miner dies
// (src/modes.ts's `triggerDeath`, "death" Cue, fired well before the death animation resolves
// to Game Over). Audio is read from the Web Audio sources the build starts (see `api.audio`).
// We strand a grounded, underground miner with a dry tank (as fuel.out-death arranges), arm
// audio, and run the real sim until Game Over, reading the audio log across the death.

import {
  newRun,
  standAt,
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
  let r;

  return {
    id: "audio.death-cue",

    // A grounded underground miner with a dry tank — the death itself is left to the real path.
    async arrange(api) {
      await newRun(api);
      await standAt(api, col, row);
      await api.call("setFuel", 0);
      await armAudio(api);
    },

    async act(api) {
      before = await audioCount(api);
      // 180 ticks = the old 3 s cap; poll 6 = the old 0.1 s chunk.
      r = await api.until((s) => s.screen === "game-over", {
        max: 180,
        poll: 6,
      });
      await drainAudioQueue(api);
      after = await audioCount(api);
    },

    async assert(api, check) {
      check.expectEq(
        "running dry underground ends the run at Game Over",
        r.snap.screen,
        "game-over",
      );
      check.expectGt(
        "a death cue plays on the death (Web Audio sources started)",
        after,
        before,
      );
    },
  };
}
