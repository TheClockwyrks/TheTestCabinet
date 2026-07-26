// Automated validation for the Audio item `zap`: a sharp zap plays when a Capacitor (or
// Emitter) fires. Audio is read from the Web Audio sources the build starts (see
// `api.audio`). A Capacitor is armed at the entry-adjacent spot and a Load is released at
// the Entry, in range immediately; audio is armed, and the real simulation is stepped until
// the tower's own `firing` flag reports the shot — the audio log must grow across it.

import {
  armTower,
  spawnControlled,
  towerById,
  armAudio,
  audioCount,
  AUDIO_SETTLE_MS,
  TICK,
} from "../_helpers.mjs";

const FIRE_MAX_TICKS = 60; // 1 s — comfortably past a fresh tower's zero-cooldown first shot

export default function item() {
  let before;
  let after;
  let fired;
  let towerId;

  return {
    id: "audio.zap",

    async arrange(api) {
      towerId = await armTower(api, { type: "capacitor", tier: 1 });
      await spawnControlled(api, "mote");
      await armAudio(api);
    },

    async act(api) {
      before = await audioCount(api);
      const r = await api.until((s) => Boolean(towerById(s, towerId)?.firing), {
        max: FIRE_MAX_TICKS,
        poll: TICK,
      });
      fired = r.hit;
      await api.settle(AUDIO_SETTLE_MS);
      after = await audioCount(api);
    },

    async assert(api, check) {
      check.expectOk("the Capacitor fires", fired);
      check.expectGt(
        "a zap cue plays on the shot (Web Audio sources started)",
        after,
        before,
      );
    },
  };
}
