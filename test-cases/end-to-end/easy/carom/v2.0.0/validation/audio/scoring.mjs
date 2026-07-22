// Automated validation for the Audio sub-item `scoring`: a cue plays when a point is
// scored.
//
// Audio is armed with one neutral key press (the game must not autoplay), then a real
// ball is driven out the right goal. The real scoring code increments the score and
// the audio log must grow across the point — the build played a cue. See
// validation/_helpers.mjs.

import { startPlaying, armAudio, arrangeGoal, actGoal } from "../_helpers.mjs";

export default function item() {
  let before;
  let scored;
  let after;

  return {
    id: "audio.scoring",

    async arrange(api) {
      await startPlaying(api, "versus");
      await armAudio(api);
      await arrangeGoal(api, "right");
    },

    async act(api) {
      before = (await api.audio()).length;
      scored = await actGoal(api);
      after = (await api.audio()).length;
    },

    async assert(api, check) {
      check.expectEq("a point is scored (player one)", scored.score.p1, 1);
      check.expectGt(
        "a cue is played on the scored point (Web Audio sources started)",
        after,
        before,
      );
    },
  };
}
