// Automated validation for audio.impact-thud: an impact thud plays on an impact event —
// jettisoning the Core Sample is the cleanest, deterministic trigger of it (src/game.ts's
// `jettisonCoreSample`, "impact" Cue; the same cue also lands on a hard landing and on
// dropping ore). Audio is read from the Web Audio sources the build starts (see `api.audio`).
// We extract a Core Sample, arm audio, and jettison it, reading the audio log across the
// single instant call.

import { newRun, armAudio, audioCount, drainAudioQueue } from "../_helpers.mjs";

export default function item() {
  let before;
  let after;
  let snap;

  return {
    id: "audio.impact-thud",

    // A carried Core Sample, ready to jettison.
    async arrange(api) {
      await newRun(api);
      await api.call("spawnCoreSample");
      await armAudio(api);
    },

    // The jettison IS the impact event under test, so it happens here and the clip shows it.
    async act(api) {
      before = await audioCount(api);
      await api.call("jettison");
      snap = await api.snapshot();
      await drainAudioQueue(api);
      after = await audioCount(api);
      await api.advance(10); // a short tail so the clip shows the ground item land
    },

    async assert(api, check) {
      check.expectOk(
        "the Core Sample is jettisoned to the ground",
        snap.satchel.coreSample === false,
      );
      check.expectGt(
        "an impact-thud cue plays on the jettison (Web Audio sources started)",
        after,
        before,
      );
    },
  };
}
