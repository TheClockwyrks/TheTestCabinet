// Automated validation for the Audio item `ink`: a cue plays when the forager releases
// ink. Audio is read from the Web Audio sources the build starts (see `api.audio`). The
// ink cooldown is cleared, audio is armed with a real gesture, and a real Shift press
// drops a cloud through the game's own ability code; the audio log must grow across it.

import { startPlaying, armAudio, audioCount } from "../_helpers.mjs";

export default function item() {
  let before;
  let after;
  let dropped;

  return {
    id: "audio.ink",

    async arrange(api) {
      await startPlaying(api);
      await api.call("clearCooldowns"); // ink ready
      await armAudio(api);
    },

    async act(api) {
      before = await audioCount(api);
      await api.call("press", "ShiftLeft"); // drop an ink cloud
      await api.advance(30);
      after = await audioCount(api);
      dropped = (await api.snapshot()).ink.cooldown > 0;
    },

    async assert(api, check) {
      check.expectOk("the forager releases ink", dropped);
      check.expectGt(
        "an ink cue plays (Web Audio sources started)",
        after,
        before,
      );
    },
  };
}
