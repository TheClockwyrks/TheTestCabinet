// Automated validation for audio.ore-pickup: an ore pickup blip plays when a drilled vein
// banks a unit into cargo (src/drill.ts's `completeDrill`, "ore-pickup" Cue). Audio is read
// from the Web Audio sources the build starts (see `api.audio`). We set an ore tile below the
// miner (as economy.ore-to-cargo arranges), arm audio, and drill it, reading the audio log
// across the real collection.

import {
  teleportInto,
  K,
  newRun,
  SPAWN_COL,
  TOPSOIL_ROW,
  armAudio,
  audioCount,
  drainAudioQueue,
} from "../_helpers.mjs";

export default function item() {
  const col = SPAWN_COL;
  const row = TOPSOIL_ROW;
  let before;
  let after;
  let r;

  return {
    id: "audio.ore-pickup",

    // An empty bay, standing over a ferron vein with rock beneath it.
    async arrange(api) {
      await newRun(api);
      await teleportInto(api, col, row);
      await api.call("setTile", col, row + 1, { kind: "ore", ore: "ferron" });
      await api.call("setTile", col, row + 2, { kind: "rock" });
      await teleportInto(api, col, row);
      await armAudio(api);
    },

    // Drill until the ore lands in the bay — the collection is what is driven and shown.
    async act(api) {
      before = await audioCount(api);
      await api.call("keyDown", K.down);
      // 120 ticks = the old 2 s cap; poll 3 = the old 0.05 s chunk, fine enough to catch the
      // instant the unit is banked.
      r = await api.until((s) => s.cargo.slotsUsed > 0, { max: 120, poll: 3 });
      await api.call("keyUp", K.down);
      await drainAudioQueue(api);
      after = await audioCount(api);
      await api.advance(10); // a short tail so the clip shows the pickup
    },

    async assert(api, check) {
      check.expectOk("drilling banks the ferron unit", r.hit);
      check.expectGt(
        "an ore-pickup cue plays on collection (Web Audio sources started)",
        after,
        before,
      );
    },
  };
}
