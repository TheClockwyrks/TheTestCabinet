// Automated validation for the Audio sub-item `scoring`: a cue plays when a point is
// scored.
//
// Audio is armed with one real key press (the game must not autoplay), then a real
// ball is driven out the right goal in real time. The real scoring code increments the
// score and the audio log must grow across the point — the build played a cue. See
// validation/_helpers.mjs.

import {
  startPlaying,
  armAudio,
  arrangeGoal,
  actCue,
  assertCue,
} from "../_helpers.mjs";

export default function item() {
  let cue;

  return {
    id: "audio.scoring",

    async arrange(api) {
      await startPlaying(api, "versus");
      await armAudio(api);
      await arrangeGoal(api, "right");
    },

    async act(api) {
      // The point is the rally ending: a scored ball respawns to the countdown, a
      // match point to the match-over screen, so either way play leaves "playing".
      cue = await actCue(api, (s) => s.screen !== "playing");
    },

    async assert(api, check) {
      check.expectEq("a point is scored (player one)", cue.snap.score.p1, 1);
      assertCue(check, cue, { what: "the scored point" });
    },
  };
}
