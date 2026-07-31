// Automated validation for audio.music: a produced descent music bed starts on the first
// interaction, and no audio plays before that (src/audio.ts's `resume`, which unconditionally
// wants the "music" LoopCue from the first real gesture on; specs/assets.md, specs/controls.md).
// Audio is read from the Web Audio sources the build starts (see `api.audio`). Unlike every
// other audio item, the event under test IS the arming gesture itself, so — uniquely here —
// `armAudio` is called from `act`, not `arrange`: `before` must be read on a fresh, untouched
// title, before anything has interacted.

import { newRun, armAudio, audioCount } from "../_helpers.mjs";

export default function item() {
  let before;
  let after;

  return {
    id: "audio.music",

    // A fresh expedition, before any interaction has armed audio.
    async arrange(api) {
      await newRun(api);
      before = await audioCount(api);
    },

    // The first real gesture is the event under test: it is what unlocks the whole audio graph
    // and starts the music bed looping.
    async act(api) {
      await armAudio(api);
      after = await audioCount(api);
      await api.advance(15); // a short tail so the clip shows the bed looping in
    },

    async assert(api, check) {
      check.expectEq("no audio plays before the first interaction", before, 0);
      check.expectGt(
        "the music bed starts on the first interaction (Web Audio sources started)",
        after,
        before,
      );
    },
  };
}
