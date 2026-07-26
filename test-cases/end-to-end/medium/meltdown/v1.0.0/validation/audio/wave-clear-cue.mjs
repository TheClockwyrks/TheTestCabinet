// Automated validation for the Audio item `wave-clear-cue`: a distinct cue plays
// when a wave clears. Audio is read from the Web Audio sources the build starts
// (see `api.audio`). Deep Pockets wave 1 (not the final wave, so this is a clear
// rather than a victory — the same setup as `economy.wave-clear-bonus`) is sent
// with no defense; audio is armed, and letting the whole wave leak past to a clear
// must grow the audio log.

import { newGame, armAudio, audioCount } from "../_helpers.mjs";

export default function item() {
  let before;
  let after;
  let cleared;

  return {
    id: "audio.wave-clear-cue",

    // No towers, so the wave resolves itself out; a bottomless life reserve so the
    // whole wave leaking past cannot end the run before it clears.
    async arrange(api) {
      await newGame(api, "deeppockets");
      await api.call("setLives", 1000000);
      await api.call("startWave"); // begin wave 1
      await armAudio(api);
    },

    // 2400 ticks = the old 40s cap, polled every 12 ticks (the old 0.2s chunk) — the
    // wave number only advances at the clear.
    async act(api) {
      before = await audioCount(api);
      const r = await api.until((s) => s.wave === 2, { max: 2400, poll: 12 });
      after = await audioCount(api);
      cleared = r.hit;
      await api.advance(30); // a short tail so the clip shows the clear
    },

    async assert(api, check) {
      check.expectOk("wave 1 clears and the run advances to wave 2", cleared);
      check.expectGt(
        "a cue plays when a wave clears (Web Audio sources started)",
        after,
        before,
      );
    },
  };
}
