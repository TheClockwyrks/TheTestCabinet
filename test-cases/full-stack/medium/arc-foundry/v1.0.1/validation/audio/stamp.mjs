// Automated validation for the Audio item `stamp`: a press/stamp clunk plays when a rock
// drops from the scrap-press. Audio is read from the Web Audio sources the build starts
// (see `api.audio`). A fresh build phase is posed, audio is armed with a real gesture, and a
// real rock is rolled and dropped through the placement path (`setNextRoll` + `placeRock`,
// specs/instrumentation.md); the audio log must grow across the drop.

import {
  startBuild,
  placeCandidate,
  armAudio,
  audioCount,
  audioCueLabel,
  waitForAudio,
  TOWER,
} from "../_helpers.mjs";

export default function item() {
  let before;
  let after;
  let placed;

  return {
    id: "audio.stamp",

    async arrange(api) {
      await startBuild(api);
      await armAudio(api);
    },

    async act(api) {
      before = await audioCount(api);
      placed = await placeCandidate(api, "capacitor", 1, TOWER.col, TOWER.row);
      after = await waitForAudio(api, before);
    },

    async assert(api, check) {
      check.expectOk("a rock is placed as a candidate", placed != null);
      check.expectGt(
        audioCueLabel("a stamp cue plays when the rock drops", after),
        after,
        before,
      );
    },
  };
}
