// Automated validation for the Audio item `victory`: the Victory sting plays when the
// final level is cleared. Audio is read from the Web Audio sources the build starts
// (see `api.audio`). The level is set to the final level with four bays posed filled,
// the critter is placed one hop below the last open bay, audio is armed, and a real
// up-hop fills it — winning the run. The audio log must grow across the win and the
// game must reach the victory screen.
//
// The two are measured over different windows, deliberately. The cue window stays
// tight around the fill, because the sting is scheduled as the last bay lands and
// widening it would only invite an unrelated later cue to be counted as this one.
// Reaching the victory SCREEN is waited for over a generous one: specs/gameplay.md
// says clearing level 8 wins and specs/ui.md says the Victory screen is shown when
// it does, and neither pins how soon. A build that runs a clearing flourish before
// the screen appears has done nothing wrong — the reference switches at once, but a
// window sized to that fails a build that holds the moment for a second.

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
  let won;
  const col = BAYS[4][0];

  return {
    id: "audio.victory",

    async arrange(api) {
      await startCrossing(api);
      await api.call("setLevel", 8); // the final level
      await api.call("setBays", [true, true, true, true, false]);
      await api.call("setLane", WATER_TOP, { cols: [col], speed: 0 });
      await api.call("placeCritter", col, WATER_TOP);
      await armAudio(api);
    },

    async act(api) {
      before = await audioCount(api);
      await api.call("press", "ArrowUp"); // fill the last bay of the last level → victory
      await api.advance(30);
      after = await audioCount(api);
      won = (
        await api.until((s) => s.screen === "victory", {
          max: 600,
          poll: 6, // 5 s at a 0.05 s cadence
        })
      ).hit;
    },

    async assert(api, check) {
      check.expectOk("clearing the final level reaches victory", won);
      check.expectGt(
        "the Victory sting plays (Web Audio sources started)",
        after,
        before,
      );
    },
  };
}
