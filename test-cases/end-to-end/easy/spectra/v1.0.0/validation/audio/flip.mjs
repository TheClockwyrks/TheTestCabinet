// Automated validation for the Audio item `flip`: a cue plays when the ship flips
// its band. Audio is read from the Web Audio sources the build starts (see
// `api.audio`). The flip key is pressed once from a clean wave; the real flip
// instantly swaps the ship's band, and the audio log must grow across it.

import {
  startClean,
  armAudio,
  actAudioCount,
  LEAD_IN_TICKS,
} from "../_helpers.mjs";

export default function item() {
  let before;
  let after;
  let flipped;

  return {
    id: "audio.flip",

    async arrange(api) {
      await startClean(api);
      await api.call("setShipBand", "cyan");
      await armAudio(api);
    },

    async act(api) {
      // A beat on the ship holding cyan, so the band change is something a reviewer
      // sees happen rather than a colour that was already there when the clip
      // opened.
      await api.advance(LEAD_IN_TICKS);

      before = await actAudioCount(api);
      await api.call("press", "KeyF");
      after = await actAudioCount(api);
      flipped = (await api.snapshot()).ship.band === "magenta";
      await api.advance(90); // a tail so the clip holds on the flipped ship
    },

    async assert(api, check) {
      check.expectOk("the ship flips band", flipped);
      check.expectGt(
        "a flip cue plays (Web Audio sources started)",
        after,
        before,
      );
    },
  };
}
