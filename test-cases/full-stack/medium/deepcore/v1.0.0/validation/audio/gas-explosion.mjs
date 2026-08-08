// Automated validation for audio.gas-explosion: a gas explosion cue plays the instant a drilled
// gas pocket detonates (src/hazards.ts's `detonateGas`, "gas-explosion" Cue). Audio is read
// from the Web Audio sources the build starts (see `api.audio`). We stand the miner over a gas
// pocket (as hazards.gas-detonates arranges, hulled up to survive the blast), arm audio, and
// drill into it, reading the audio log across the real detonation.

import {
  teleportInto,
  K,
  newRun,
  standAt,
  SPAWN_COL,
  ROCKBED_ROW,
  armAudio,
  audioCount,
  drainAudioQueue,
} from "../_helpers.mjs";

export default function item() {
  const col = SPAWN_COL;
  const row = ROCKBED_ROW;
  let hull0;
  let before;
  let after;
  let r;

  return {
    id: "audio.gas-explosion",

    // A grounded miner standing over a gas pocket, hulled up enough to survive the blast.
    async arrange(api) {
      await newRun(api);
      await standAt(api, col, row);
      await api.call("setTile", col, row + 1, { kind: "gas" });
      await api.call("setTile", col, row + 2, { kind: "rock" });
      await teleportInto(api, col, row);
      await api.call("grantGear", { hull: 3 }); // survive the deadly rockbed gas
      // Fill the hull explicitly: a build that raises the ceiling without granting the capacity
      // leaves the miner on `100/220`, where the rockbed hit (`~60` and rising, `specs/hazards.md`)
      // can kill it — and a death cue landing on top of the blast is not what this item is reading.
      // The grant contract has its own item, `economy.grant-applies-tiers`.
      await api.call("setHull", 100000);
      hull0 = (await api.snapshot()).miner.hull;
      await armAudio(api);
    },

    // The cut into the pocket and the detonation it triggers are what is driven and shown.
    async act(api) {
      before = await audioCount(api);
      await api.call("keyDown", K.down);
      // 180 ticks = the old 3 s cap; poll 3 = the old 0.05 s chunk, fine enough to catch the
      // detonation instant.
      r = await api.until((s) => s.miner.hull < hull0, { max: 180, poll: 3 });
      await api.call("keyUp", K.down);
      await drainAudioQueue(api);
      after = await audioCount(api);
      await api.advance(10); // a short tail so the clip shows the blast
    },

    async assert(api, check) {
      check.expectOk(
        "drilling the pocket detonates it",
        r.hit && r.snap.miner.hull < hull0,
      );
      check.expectGt(
        "a gas-explosion cue plays on detonation (Web Audio sources started)",
        after,
        before,
      );
    },
  };
}
