// Automated validation for the Audio item `level-clear`: a cue plays when the last bay
// of a level is filled and the level clears. Audio is read from the Web Audio sources
// the build starts (see `api.audio`). Four bays are posed filled, the critter is placed
// one hop below the last open bay, audio is armed, and a real up-hop fills it — clearing
// the level (level 1, below the final level, so it is a clear rather than victory). The
// audio log must grow across the clear.

import {
  startCrossing,
  armAudio,
  audioCount,
  BAYS,
  WATER_TOP,
} from "../_helpers.mjs";

export default function item() {
  let before;
  let after;
  let cleared;
  const col = BAYS[4][0]; // the last (rightmost) bay's column

  return {
    id: "audio.level-clear",

    async arrange(api) {
      await startCrossing(api);
      await api.call("setBays", [true, true, true, true, false]); // only the last bay open
      await api.call("setLane", WATER_TOP, { cols: [col], speed: 0 });
      await api.call("placeCritter", col, WATER_TOP);
      await armAudio(api);
    },

    async act(api) {
      before = await audioCount(api);
      await api.call("press", "ArrowUp"); // fill the last bay → level clears
      await api.advance(30);
      after = await audioCount(api);
      cleared = (await api.snapshot()).bays.every(Boolean);
    },

    async assert(api, check) {
      check.expectOk("the last bay fills and the level clears", cleared);
      check.expectGt(
        "a cue plays on the level clear (Web Audio sources started)",
        after,
        before,
      );
    },
  };
}
