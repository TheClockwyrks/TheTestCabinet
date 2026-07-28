// Automated validation for the Audio item `hit`: a cue plays when an opposite-band
// bullet costs the ship a life. Audio is read from the Web Audio sources the build
// starts (see `api.audio`). An opposite-band enemy bullet is sent onto the ship,
// audio is armed, and the real shield resolves it into a lost life; the audio log
// must grow across the hit. Lives are posed high enough that the loss is a
// decrement rather than a game over, isolating the hit cue.

import {
  startClean,
  armAudio,
  actAudioCount,
  shieldBullet,
} from "../_helpers.mjs";

export default function item() {
  let before;
  let after;
  let hit;

  return {
    id: "audio.hit",

    async arrange(api) {
      await startClean(api);
      await api.call("setShipBand", "cyan");
      await api.call("setLives", 3);
      await shieldBullet(api, "magenta"); // opposite the ship's band
      await armAudio(api);
    },

    async act(api) {
      before = await actAudioCount(api);
      const r = await api.until((s) => s.lives < 3, { max: 36 }); // 36 ticks = 0.3 s
      after = await actAudioCount(api);
      hit = r.hit;
      await api.advance(30); // a short tail so the clip shows the aftermath
    },

    async assert(api, check) {
      check.expectOk("an opposite-band bullet costs a life", hit);
      check.expectGt(
        "a hit cue plays (Web Audio sources started)",
        after,
        before,
      );
    },
  };
}
