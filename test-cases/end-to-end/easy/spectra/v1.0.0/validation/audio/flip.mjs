// Automated validation for the Audio item `flip`: a cue plays when the ship flips
// its band. Audio is read from the Web Audio sources the build starts (see
// `api.audio`). The flip key is pressed once from a clean wave; the real flip
// instantly swaps the ship's band, and the audio log must grow across it.

import {
  startClean,
  spawnBystander,
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

    // The flip is a keyboard action of the LIVE WAVE, so the wave has to still be
    // running when the key is pressed. A cleared field is a cleared wave (see
    // `spawnBystander`), so an empty one ends the wave on the first tick of the
    // lead-in and the press then lands on the stage-cleared screen, where the flip
    // key does nothing — no band change, no cue, and a stage-clear cue of its own in
    // the audio log to confuse the count. One bystander keeps the wave live.
    async arrange(api) {
      await startClean(api);
      await spawnBystander(api);
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
