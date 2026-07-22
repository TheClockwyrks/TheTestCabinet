// Automated validation for the Audio sub-item `obstacle-bounce`: a short cue plays
// when the ball bounces off a mid-field obstacle.
//
// Audio is armed with one neutral key press (the game must not autoplay), then the
// ball is fired straight at obstacle A. The real collision reflects it and the audio
// log must grow across the bounce — the build played a cue. See
// validation/_helpers.mjs.

import {
  startPlaying,
  armAudio,
  arrangeObstacleBounce,
  actObstacleBounce,
  OBSTACLE_A,
} from "../_helpers.mjs";

export default function item() {
  let before;
  let r;
  let after;

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
      before = (await api.audio()).length;
      r = await actObstacleBounce(api, "left");
      after = (await api.audio()).length;
      await api.advance(60); // a short tail so the clip shows the rebound
    },

    async assert(api, check) {
      check.expectOk("the ball bounces off the obstacle", r.hit);
      check.expectGt(
        "a cue is played on the obstacle bounce (Web Audio sources started)",
        after,
        before,
      );
    },
  };
}
