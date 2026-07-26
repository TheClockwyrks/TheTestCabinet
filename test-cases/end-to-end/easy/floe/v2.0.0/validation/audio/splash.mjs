// Automated validation for the Audio item `splash`: a cue plays when the critter
// drops into open water and drowns. Audio is read from the Web Audio sources the
// build starts (see `api.audio`). The critter is posed on an open-water tile with no
// floe under it, audio is armed with a real gesture, and the real footing logic is
// stepped so the critter drowns; the audio log must grow across the death. Lives stay
// at the fresh-run default so the death respawns rather than ending the run, isolating
// the splash cue.

import { startCrossing, armAudio, audioCount } from "../_helpers.mjs";

export default function item() {
  let before;
  let after;
  let drowned;

  return {
    id: "audio.splash",

    async arrange(api) {
      await startCrossing(api);
      await api.call("setLane", 5, { cols: [] }); // open water at row 5: no floe
      await api.call("placeCritter", 20, 5); // stand on open water
      await armAudio(api);
    },

    async act(api) {
      before = await audioCount(api);
      const r = await api.until((s) => s.phase !== "crossing", {
        max: 30,
        poll: 1,
      });
      after = await audioCount(api);
      drowned = r.hit;
      await api.advance(30); // a short tail so the clip shows the splash
    },

    async assert(api, check) {
      check.expectOk("the critter drowns in open water", drowned);
      check.expectGt(
        "a splash cue plays (Web Audio sources started)",
        after,
        before,
      );
    },
  };
}
