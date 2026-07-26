// Automated validation for the Audio item `discharge`: a cue plays when the ship
// fires a discharge. Audio is read from the Web Audio sources the build starts
// (see `api.audio`). The resonance meter is filled and a real discharge fired; the
// audio log must grow across it.

import { startClean, armAudio, audioCount } from "../_helpers.mjs";

export default function item() {
  let before;
  let after;
  let discharged;

  return {
    id: "audio.discharge",

    // A live stage-1 wave with the meter posed full, its swarm kept so the clip
    // shows the discharge sweeping a real field.
    async arrange(api) {
      await startClean(api, { clear: false });
      await api.call("setResonance", 100);
      await armAudio(api);
    },

    async act(api) {
      before = await audioCount(api);
      await api.call("discharge");
      // Read immediately: firing is instantaneous.
      after = await audioCount(api);
      discharged = (await api.snapshot()).discharge.active === true;
      await api.advance(60); // a short tail so the clip shows the expanding wave
    },

    async assert(api, check) {
      check.expectOk("the discharge fires", discharged);
      check.expectGt(
        "a discharge cue plays (Web Audio sources started)",
        after,
        before,
      );
    },
  };
}
