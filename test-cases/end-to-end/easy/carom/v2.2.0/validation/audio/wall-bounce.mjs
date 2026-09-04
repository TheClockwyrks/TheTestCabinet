// Automated validation for the Audio sub-item `wall-bounce`: a short cue plays when
// the ball bounces off the side wall of the playfield (the top or bottom edge — the
// left and right edges are goals).
//
// Audio is armed with one real key press (the game must not autoplay), then the ball
// is fired straight into the top wall and the bounce is let happen in real time. The
// real collision reflects it and the audio log must grow across the bounce — the build
// played a cue. See validation/_helpers.mjs.

import {
  startPlaying,
  clearPaddles,
  armAudio,
  actCue,
  assertCue,
  ball0,
} from "../_helpers.mjs";

export default function item() {
  let cue;

  return {
    id: "audio.wall-bounce",

    async arrange(api) {
      await startPlaying(api, "versus");
      await armAudio(api);
      await clearPaddles(api);
      // Straight up into the top wall.
      await api.call("setBall", 0, { x: 640, y: 80, vx: 0, vy: -500, spin: 0 });
    },

    async act(api) {
      // The bounce is the ball's vertical velocity reversing.
      cue = await actCue(api, (s) => ball0(s).vy > 0);
    },

    async assert(api, check) {
      check.expectOk(
        "the ball bounces off the top wall (vy reverses)",
        cue.reached,
      );
      assertCue(check, cue, { what: "the wall bounce" });
    },
  };
}
