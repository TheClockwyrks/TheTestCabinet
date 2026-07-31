// Automated validation for audio.alarm-core: an escalating core-timer alarm loops while the
// Core Sample's countdown is running (src/audio.ts's "alarm-core" LoopCue, started via
// `game.activeLoops` in updateLoops — src/game.ts, and kept running even behind an open panel).
// Audio is read from the Web Audio sources the build starts (see `api.audio`). We extract a
// Core Sample (as core-run.extract-timer arranges) and step the real sim one beat so
// `activeLoops` recomputes, reading the audio log across it.

import { newRun, armAudio, audioCount, awaitCue } from "../_helpers.mjs";

export default function item() {
  let before;
  let after;
  let snap;

  return {
    id: "audio.alarm-core",

    // A freshly-armed 90 s countdown, carried in the satchel.
    async arrange(api) {
      await newRun(api);
      await api.call("spawnCoreSample");
      await armAudio(api);
    },

    async act(api) {
      before = await audioCount(api);
      // A couple of real fixed steps so the live-play update recomputes the alarm condition with
      // the timer running.
      await api.advance(2);
      snap = await api.snapshot();
      // Wait for the alarm rather than reading once after a fixed drain. specs/assets.md specifies
      // this cue as an "escalating countdown BEEP", so a build is free to implement it as a
      // repeating one-shot whose period shrinks with the timer — over a second between sources at
      // a fresh 90 s countdown. A single 60 ms read lands inside that gap and reports silence for
      // an alarm that is sounding exactly as specified; polling to a deadline catches a continuous
      // loop and a repeating beep alike.
      after = await awaitCue(api, before);
    },

    async assert(api, check) {
      check.expectOk(
        "the Core Sample countdown is running",
        snap.coreTimer !== null && snap.coreTimer > 0,
      );
      check.expectGt(
        "a core-timer alarm loops while the Sample is live (Web Audio sources started)",
        after,
        before,
      );
    },
  };
}
