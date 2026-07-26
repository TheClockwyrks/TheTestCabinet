// Automated validation for audio.lava-sizzle: a lava sizzle plays while the miner is in contact
// with lava (src/hazards.ts's `updateLavaContact`, "lava-sizzle" Cue, on a short repeating
// cooldown). Audio is read from the Web Audio sources the build starts (see `api.audio`). We
// stand the miner on a lava tile (as hazards.lava-drains arranges), arm audio, and step the real
// sim across the contact, reading the audio log and the hull drain it causes.

import {
  teleportInto,
  newRun,
  SPAWN_COL,
  DEEPSTONE_ROW,
  armAudio,
  audioCount,
  drainAudioQueue,
} from "../_helpers.mjs";

export default function item() {
  const col = SPAWN_COL;
  const row = DEEPSTONE_ROW;
  let hull0;
  let before;
  let after;
  let snap;

  return {
    id: "audio.lava-sizzle",

    async arrange(api) {
      await newRun(api);
      await teleportInto(api, col, row);
      await api.call("setTile", col, row + 1, { kind: "lava" }); // lava underfoot
      await teleportInto(api, col, row);
      hull0 = (await api.snapshot()).miner.hull;
      await armAudio(api);
    },

    // The contact drain is the behavior, and the clip shows the hull bar falling on lava.
    async act(api) {
      before = await audioCount(api);
      await api.advance(30); // 30 ticks = 0.5 s, past the sizzle's 0.25 s cooldown
      snap = (await api.snapshot()).miner;
      await drainAudioQueue(api);
      after = await audioCount(api);
    },

    async assert(api, check) {
      check.expectLt("lava contact drains hull", snap.hull, hull0);
      check.expectGt(
        "a lava-sizzle cue plays on contact (Web Audio sources started)",
        after,
        before,
      );
    },
  };
}
