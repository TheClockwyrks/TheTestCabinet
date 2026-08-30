// Automated validation for audio.drill-loop: a drill loop plays while the miner cuts into a
// tile (src/audio.ts's "drill" LoopCue, started via `game.activeLoops` in updateLoops —
// src/game.ts). Audio is read from the Web Audio sources the build starts (see `api.audio`).
// The miner is posed grounded on a rock floor with solid rock below the target too (a
// continuous shaft, as movement.drill-down arranges), audio is armed, and a real down-hold
// drives the cut partway through — well short of the tile breaking — so the loop is isolated
// from the ore/material/gas payload cues a completed cut might also fire.

import {
  K,
  newRun,
  standAt,
  solid,
  TOPSOIL_ROW,
  SPAWN_COL,
  armAudio,
  audioCount,
  drainAudioQueue,
} from "../_helpers.mjs";

export default function item() {
  const col = SPAWN_COL;
  const row = TOPSOIL_ROW;
  let before;
  let after;
  let mid;

  return {
    id: "audio.drill-loop",

    async arrange(api) {
      await newRun(api);
      await standAt(api, col, row); // grounded on a rock floor at (col, row+1)
      await solid(api, col, row + 2); // solid below the target, so the shaft is continuous
      await armAudio(api);
    },

    async act(api) {
      before = await audioCount(api);
      await api.call("keyDown", K.down);
      await api.advance(15); // 15 ticks = 0.25 s, partway through the ~0.5 s topsoil cut
      mid = (await api.snapshot()).miner;
      await drainAudioQueue(api);
      after = await audioCount(api);
      await api.advance(10); // a short tail so the clip shows the cut under way
      await api.call("keyUp", K.down);
    },

    async assert(api, check) {
      check.expectOk(
        "a down cut is under way",
        !!mid.drilling && mid.drilling.dir === "down",
      );
      check.expectGt(
        "a drill loop cue plays while cutting (Web Audio sources started)",
        after,
        before,
      );
    },
  };
}
