// Automated validation for the Audio item `produced-music`: a looping music bed plays
// under the round. Unlike the one-shot cues, the bed is not tied to a game EVENT — it
// starts the moment audio is armed with the round already underway (audio.ts starts it
// from the same first-gesture handler that creates the AudioContext, specs/ui.md). So
// the audio log is read before and after arming itself, with the round already live,
// rather than around a driven action.
//
// Arming is a real browser gesture (userKey + userClick, see `armAudio`), which
// triggers an async fetch + decodeAudioData of the produced .wav before the bed's
// source is created — real wall-clock work no amount of instant ticking can wait out.
// `api.settle` (unlike `api.advance`) is a genuine real-time pause in BOTH passes (see
// `packages/browser-driver/validation.mjs`), so it is used here to let that decode land
// before the log is read back, rather than the tick-based `api.advance` this case's
// other items use.

import { armAudio, audioCount, beginRound } from "../_helpers.mjs";

// Real wall-clock time to let the first-gesture resume() fetch and decode the produced
// clips and start the bed (specs/assets.md) — generous for a small local .wav.
const SETTLE_MS = 300;

export default function item() {
  let before;
  let after;

  return {
    id: "audio.produced-music",

    async arrange(api) {
      await beginRound(api); // the round is underway before audio is ever armed
    },

    async act(api) {
      before = await audioCount(api);
      await armAudio(api); // the real gesture that unlocks the AudioContext
      await api.settle(SETTLE_MS); // real time for the decode and the bed to start
      after = await audioCount(api);
    },

    async assert(api, check) {
      check.expectGt(
        "a Web Audio source starts once armed with the round underway (the music bed)",
        after,
        before,
      );
    },
  };
}
