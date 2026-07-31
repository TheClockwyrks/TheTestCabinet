// Automated validation for audio.confirm: a purchase/fabricate confirm plays when a buy or
// fabricate lands (src/economy.ts's `buyUpgrade` and its siblings, src/rocket.ts's `fabricate`,
// all pushing the "fabricate" Cue). Audio is read from the Web Audio sources the build starts
// (see `api.audio`). We fund the miner (as economy.buy-upgrade arranges), arm audio, and buy a
// fuel-tank tier, reading the audio log across the real purchase.

import { newRun, armAudio, audioCount, drainAudioQueue } from "../_helpers.mjs";

export default function item() {
  let before;
  let after;
  let tier0;
  let snap;

  return {
    id: "audio.confirm",

    // A funded miner still on tier 1 of every track.
    async arrange(api) {
      await newRun(api);
      await api.call("grantCredits", 1000);
      tier0 = (await api.snapshot()).tiers.fuel;
      await armAudio(api);
    },

    // The purchase IS the behavior under test, so it happens here and the clip shows it land.
    async act(api) {
      before = await audioCount(api);
      await api.call("buyUpgrade", "fuel");
      snap = await api.snapshot();
      await drainAudioQueue(api);
      after = await audioCount(api);
      await api.advance(10); // a short tail so the clip shows the purchase land
    },

    async assert(api, check) {
      check.expectOk(
        "the fuel-tank tier rises on purchase",
        tier0 === 1 && snap.tiers.fuel === 2,
      );
      check.expectGt(
        "a confirm cue plays on the purchase (Web Audio sources started)",
        after,
        before,
      );
    },
  };
}
