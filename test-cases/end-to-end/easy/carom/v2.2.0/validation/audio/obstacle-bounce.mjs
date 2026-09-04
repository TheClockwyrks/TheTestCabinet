// Automated validation for the Audio sub-item `obstacle-bounce`: a short cue plays
// when the ball bounces off a mid-field obstacle.
//
// Audio is armed with one real key press (the game must not autoplay), then the ball
// is fired straight at obstacle A and the bounce is let happen in real time. The real
// collision reflects it and the audio log must grow across the bounce — the build
// played a cue. See validation/_helpers.mjs.

import {
  startPlaying,
  armAudio,
  arrangeObstacleBounce,
  actCue,
  assertCue,
  ball0,
  OBSTACLE_A,
} from "../_helpers.mjs";

export default function item() {
  let cue;

  return {
    id: "audio.obstacle-bounce",

    async arrange(api) {
      await startPlaying(api, "versus");
      await armAudio(api);
      await arrangeObstacleBounce(api, {
        faceX: OBSTACLE_A.x0,
        y: OBSTACLE_A.y,
        from: "left",
      });
    },

    async act(api) {
      // The bank is the ball reflecting back off the struck face.
      cue = await actCue(api, (s) => ball0(s).vx < 0);
    },

    async assert(api, check) {
      check.expectOk("the ball bounces off the obstacle", cue.reached);
      assertCue(check, cue, { what: "the obstacle bounce" });
    },
  };
}
