// Automated validation for the Audio sub-item `paddle-hit`: a short cue plays when
// the ball strikes a paddle.
//
// Audio is synthesized with the Web Audio API (specs/ui.md), so the driver reports
// every source the build starts (see `api.audio`). Audio is armed with one real key
// press first, because the game must not autoplay before the player interacts. A real
// paddle contact is then driven in real time and the audio log must grow across it —
// the build played a cue. Nothing here inspects the sound itself; only that one was
// scheduled in response to the hit. See the audio section of validation/_helpers.mjs
// for why the arming press and the real-time window are what they are.

import {
  arrangePaddleHit,
  actCue,
  assertCue,
  startPlaying,
  armAudio,
  ball0,
} from "../_helpers.mjs";

export default function item() {
  let cue;

  return {
    id: "audio.paddle-hit",

    async arrange(api) {
      await startPlaying(api, "versus");
      await armAudio(api);
      await arrangePaddleHit(api, "left", { cy: 360, vy: 0, ballY: 360 });
    },

    async act(api) {
      // The contact is the ball turning back toward the far goal.
      cue = await actCue(api, (s) => ball0(s).vx > 0);
    },

    async assert(api, check) {
      check.expectOk("the ball strikes the paddle", cue.reached);
      assertCue(check, cue, { what: "the paddle hit" });
    },
  };
}
