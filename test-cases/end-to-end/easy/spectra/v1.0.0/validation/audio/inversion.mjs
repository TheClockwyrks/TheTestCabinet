// Automated validation for the Audio item `inversion`: a cue plays when a diving
// Prism triggers a spectral inversion. Audio is read from the Web Audio sources
// the build starts (see `api.audio`). A Prism is driven into a real exit dive to
// the bottom (arrangeInversion/actInversion); the audio log must grow across the
// trigger.

import {
  arrangeInversion,
  actInversion,
  armAudio,
  actAudioCount,
} from "../_helpers.mjs";

export default function item() {
  let before;
  let after;
  let inverted;

  return {
    // As in `drones.inversion-trigger`: whether a dive exits through the bottom is
    // an RNG roll taken at launch, and a losing attempt can burn up to 5 s, so a
    // longer clip budget leaves room for a second attempt. The validate pass is
    // uncapped, so no verdict depends on this.
    clipMs: 10000,

    id: "audio.inversion",

    async arrange(api) {
      await arrangeInversion(api);
      await armAudio(api);
    },

    async act(api) {
      before = await actAudioCount(api);
      const r = await actInversion(api);
      after = await actAudioCount(api);
      inverted = r.hit && r.snap.inversionActive;
      await api.advance(30); // a short tail so the clip shows the inverted field
    },

    async assert(api, check) {
      check.expectOk(
        "a Prism reaching the bottom triggers a spectral inversion",
        inverted,
      );
      check.expectGt(
        "an inversion cue plays (Web Audio sources started)",
        after,
        before,
      );
    },
  };
}
