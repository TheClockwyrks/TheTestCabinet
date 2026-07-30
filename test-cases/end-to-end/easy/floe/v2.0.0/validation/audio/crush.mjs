// Automated validation for the Audio item `crush`: a cue plays when a vehicle slides
// into the critter on the ice band. Audio is read from the Web Audio sources the build
// starts (see `api.audio`). The critter is posed on a cleared ice tile, a vehicle is
// then dropped onto that same tile, audio is armed, and the real footing logic is
// stepped so the crush fires; the audio log must grow across the death. Lives stay at
// the fresh-run default so the death respawns rather than ending the run, isolating the
// crush cue.

import {
  actUntilDeath,
  startCrossing,
  armAudio,
  audioCount,
  ICE_TOP,
} from "../_helpers.mjs";

export default function item() {
  let before;
  let after;
  let crushed;
  let livesBefore;

  return {
    id: "audio.crush",

    async arrange(api) {
      await startCrossing(api);
      const row = ICE_TOP + 1; // an ice-band row
      await api.call("setLane", row, { cols: [] }); // clear it first
      await api.call("placeCritter", 20, row); // stand on the empty ice tile
      await api.call("setLane", row, { cols: [20], speed: 0 }); // drop a vehicle onto it
      livesBefore = (await api.snapshot()).lives; // the fresh-run default, read instantly
      await armAudio(api);
    },

    async act(api) {
      before = await audioCount(api);
      const r = await actUntilDeath(api, livesBefore, { max: 30 });
      after = await audioCount(api);
      crushed = r.hit;
      await api.advance(30); // a short tail so the clip shows the crush
    },

    async assert(api, check) {
      check.expectOk("a vehicle crushes the critter on the ice", crushed);
      check.expectGt(
        "a crush cue plays (Web Audio sources started)",
        after,
        before,
      );
    },
  };
}
