// Automated validation for the Audio item `sonar`: a cue plays when the forager emits a
// sonar pulse. Audio is read from the Web Audio sources the build starts (see
// `api.audio`). The sonar cooldown is cleared, audio is armed with a real gesture, and a
// real Space press fires the pulse through the game's own ability code; the audio log
// must grow across it.

import { startPlaying, armAudio, audioCount } from "../_helpers.mjs";

export default function item() {
  let before;
  let after;
  let fired;

  return {
    id: "audio.sonar",

    async arrange(api) {
      await startPlaying(api);
      await api.call("clearCooldowns"); // sonar ready
      await armAudio(api);
    },

    async act(api) {
      before = await audioCount(api);
      await api.call("press", "Space"); // fire the sonar pulse
      await api.advance(30);
      after = await audioCount(api);
      fired = (await api.snapshot()).sonar.cooldown > 0;
    },

    async assert(api, check) {
      check.expectOk("the forager fires a sonar pulse", fired);
      check.expectGt(
        "a sonar cue plays (Web Audio sources started)",
        after,
        before,
      );
    },
  };
}
