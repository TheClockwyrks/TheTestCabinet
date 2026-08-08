// Automated validation for audio.launch-roar: a launch roar plays the instant the rocket
// launches (src/game.ts's `startLaunch`, "launch" Cue). Audio is read from the Web Audio
// sources the build starts (see `api.audio`). We supply everything the five components need
// and fabricate them (as rocket.launch-victory arranges), arm audio, and launch, reading the
// audio log across the real launch sequence to Victory.

import { newRun, armAudio, audioCount, drainAudioQueue } from "../_helpers.mjs";

export default function item() {
  let installed;
  let before;
  let after;
  let r;

  return {
    id: "audio.launch-roar",

    // Everything the rocket needs, with all five components already fabricated onto it.
    async arrange(api) {
      await newRun(api);
      await api.call("grantCredits", 30000);
      await api.call("giveMaterial", "resonite");
      await api.call("giveMaterial", "cryenite");
      await api.call("spawnCoreSample");
      for (let i = 0; i < 5; i += 1) await api.call("fabricate");
      installed = (await api.snapshot()).rocket.installed.length;
      await armAudio(api);
    },

    // The launch and the sequence it plays out are the behavior — and the clip is the win itself.
    async act(api) {
      before = await audioCount(api);
      await api.call("launch");
      // Poll until the launch sequence resolves to Victory rather than advancing a fixed span
      // (specs/rocket.md bounds no duration for the lift-off animation). 600 ticks = 10 s is a
      // generous ceiling for any reasonable sequence.
      r = await api.until((s) => s.screen === "victory", { max: 600, poll: 6 });
      await drainAudioQueue(api);
      after = await audioCount(api);
    },

    async assert(api, check) {
      check.expectOk(
        "launching all five components wins the game",
        installed === 5 && r.hit && r.snap.screen === "victory",
      );
      check.expectGt(
        "a launch-roar cue plays on launch (Web Audio sources started)",
        after,
        before,
      );
    },
  };
}
