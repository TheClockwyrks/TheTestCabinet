// Automated validation for the Audio item `kill`: a kill/ground-out pop plays when a shot
// kills a unit. Audio is read from the Web Audio sources the build starts (see
// `api.audio`). A Capacitor is armed at the entry-adjacent spot and a low-HP Cluster is
// released at the Entry, in range and one shot from dead; audio is armed, and the real
// simulation is stepped until the unit is gone (`sim.ts`'s `kill` drops it from the live
// unit list) — the audio log must grow across the kill.

import {
  armTower,
  spawnControlled,
  armAudio,
  audioCount,
  AUDIO_SETTLE_MS,
  TICK,
} from "../_helpers.mjs";

const KILL_MAX_TICKS = 60; // 1 s — comfortably past a fresh tower's zero-cooldown first shot

export default function item() {
  let before;
  let after;
  let killed;
  let unitId;

  return {
    id: "audio.kill",

    async arrange(api) {
      await armTower(api, { type: "capacitor", tier: 1 }); // 6 dmg, one-shots a fresh Cluster
      const [cluster] = await spawnControlled(api, "cluster");
      unitId = cluster.id;
      await armAudio(api);
    },

    async act(api) {
      before = await audioCount(api);
      const r = await api.until((s) => !s.units.some((u) => u.id === unitId), {
        max: KILL_MAX_TICKS,
        poll: TICK,
      });
      killed = r.hit;
      await api.settle(AUDIO_SETTLE_MS);
      after = await audioCount(api);
    },

    async assert(api, check) {
      check.expectOk("the Cluster is killed", killed);
      check.expectGt(
        "a kill cue plays on the kill (Web Audio sources started)",
        after,
        before,
      );
    },
  };
}
