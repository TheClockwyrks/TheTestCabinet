// Automated validation for audio.music: a produced descent music bed starts on the first
// interaction, and no audio plays before that (src/audio.ts's `resume`, which unconditionally
// wants the "music" LoopCue from the first real gesture on; specs/assets.md, specs/controls.md).
// Audio is read from the Web Audio sources the build starts (see `api.audio`). Unlike every
// other audio item, the event under test IS the arming gesture itself, so — uniquely here —
// `armAudio` is called from `act`, not `arrange`: `before` must be read on a fresh, untouched
// title, before anything has interacted.

import { newRun, armAudio, audioCount, awaitCue } from "../_helpers.mjs";

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
      // Poll for the bed rather than reading once the moment `armAudio` returns.
      //
      // `armAudio` settles a fixed 250 ms after the gesture to let the first-gesture decode finish.
      // That is ample for a sound effect and is not ample for this one: the music bed is a LOOP
      // (`specs/assets.md` asks for an atmospheric loop, and the reference's own `.wav` is 2.5 MB
      // against ~10–250 kB for the cues), so its fetch and `decodeAudioData` can still be running
      // when the fixed settle expires. A single read then reports silence for a build whose music
      // starts perfectly well a moment later — which is what both builds under review looked like.
      // Polling to a real deadline accepts a bed that arrives late without accepting one that never
      // arrives; the `before` read in `arrange` still holds the honest half of this item, that
      // nothing plays before the first interaction.
      after = await awaitCue(api, before);
      await api.advance(30); // 30 ticks = 0.5 s so the clip runs on with the bed playing
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
