// Automated validation for audio.material-chime: a richer material chime plays when a
// Resonite/Cryenite node is collected (src/drill.ts's `completeDrill`, "material-chime" Cue).
// Audio is read from the Web Audio sources the build starts (see `api.audio`). We place a
// Resonite node below the miner (as materials.collect arranges), arm audio, and drill it,
// reading the audio log across the real collection.

import {
  teleportInto,
  K,
  newRun,
  SPAWN_COL,
  ROCKBED_ROW,
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
    id: "audio.material-chime",

    // An empty satchel, standing over a Resonite node with rock beneath it.
    async arrange(api) {
      await newRun(api);
      await teleportInto(api, col, row);
      await api.call("setTile", col, row + 1, {
        kind: "material",
        material: "resonite",
      });
      await api.call("setTile", col, row + 2, { kind: "rock" });
      await teleportInto(api, col, row);
      await armAudio(api);
    },

    // Drill until the material lands in the satchel — the collection is what is driven and shown.
    async act(api) {
      before = await audioCount(api);
      await api.call("keyDown", K.down);
      // 120 ticks = the old 2 s cap; poll 3 = the old 0.05 s chunk, fine enough to catch the
      // instant the node is banked.
      r = await api.until((s) => s.satchel.resonite > 0, { max: 120, poll: 3 });
      await api.call("keyUp", K.down);
      await drainAudioQueue(api);
      after = await audioCount(api);
      await api.advance(10); // a short tail so the clip shows the find
    },

    async assert(api, check) {
      check.expectOk("drilling the node banks the Resonite", r.hit);
      check.expectGt(
        "a material chime plays on a find (Web Audio sources started)",
        after,
        before,
      );
    },
  };
}
