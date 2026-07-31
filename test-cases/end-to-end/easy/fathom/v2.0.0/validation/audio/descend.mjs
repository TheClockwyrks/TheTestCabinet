// Automated validation for the Audio item `descend`: a cue plays when a maze is cleared
// and the dive descends toward the next depth. Audio is read from the Web Audio sources
// the build starts (see `api.audio`). A single plankton is posed adjacent to the forager
// (see states/cleared.mjs), audio is armed, and eating it clears the trench through the
// real scoring path; the audio log must grow across the clear.

import {
  startPlaying,
  actEatLastPlankton,
  armAudio,
  audioCount,
} from "../_helpers.mjs";

export default function item() {
  let before;
  let after;
  let cleared;

  return {
    id: "audio.descend",

    async arrange(api) {
      await startPlaying(api);
      await api.call("poseLastPlankton");
      await armAudio(api);
    },

    async act(api) {
      before = await audioCount(api);
      const r = await actEatLastPlankton(api);
      after = await audioCount(api);
      cleared = Boolean(r) && r.snap.screen === "cleared";
      await api.advance(30); // a short tail so the clip shows the cleared interstitial
    },

    async assert(api, check) {
      check.expectOk("clearing the maze reaches the cleared screen", cleared);
      check.expectGt(
        "a descend cue plays when the maze is cleared (Web Audio sources started)",
        after,
        before,
      );
    },
  };
}
