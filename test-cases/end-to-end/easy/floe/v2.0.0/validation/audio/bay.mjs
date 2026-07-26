// Automated validation for the Audio item `bay`: a cue plays when the critter fills a
// goal bay. Audio is read from the Web Audio sources the build starts (see `api.audio`).
// The critter is posed one hop below an open bay on a stationary floe, audio is armed,
// and a real up-hop fills the bay; the audio log must grow across it.

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
  let filled;
  const col = BAYS[0][0]; // a column under the leftmost open bay

  return {
    id: "audio.bay",

    async arrange(api) {
      await startCrossing(api);
      await api.call("setLane", WATER_TOP, { cols: [col], speed: 0 }); // floe under the critter
      await api.call("placeCritter", col, WATER_TOP); // one hop below the open bay
      await armAudio(api);
    },

    async act(api) {
      before = await audioCount(api);
      await api.call("press", "ArrowUp"); // hop up into the open bay
      await api.advance(30);
      after = await audioCount(api);
      filled = (await api.snapshot()).bays[0] === true;
    },

    async assert(api, check) {
      check.expectOk("the critter fills a bay", filled);
      check.expectGt(
        "a cue plays when a bay is filled (Web Audio sources started)",
        after,
        before,
      );
    },
  };
}
