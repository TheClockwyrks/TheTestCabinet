// Automated validation for the Audio item `absorb`: a cue plays when the ship's
// shield absorbs a same-band enemy bullet. Audio is read from the Web Audio
// sources the build starts (see `api.audio`). A same-band enemy bullet is sent
// onto the ship, audio is armed, and the real shield resolves the contact; the
// audio log must grow across the absorb. Resonance is zeroed so a rise confirms
// the absorb landed.

import {
  startClean,
  armAudio,
  audioCount,
  shieldBullet,
} from "../_helpers.mjs";

export default function item() {
  let before;
  let after;
  let absorbed;

  return {
    id: "audio.absorb",

    async arrange(api) {
      await startClean(api);
      await api.call("setShipBand", "cyan");
      await api.call("setLives", 3);
      await api.call("setResonance", 0);
      await shieldBullet(api, "cyan"); // same band as the ship
      await armAudio(api);
    },

    async act(api) {
      before = await audioCount(api);
      const r = await api.until((s) => s.resonance > 0, { max: 36 }); // 36 ticks = 0.3 s
      after = await audioCount(api);
      absorbed = r.hit;
      await api.advance(30); // a short tail so the clip shows the absorbed shot
    },

    async assert(api, check) {
      check.expectOk("the same-band bullet is absorbed", absorbed);
      check.expectGt(
        "an absorb cue plays (Web Audio sources started)",
        after,
        before,
      );
    },
  };
}
