// Automated validation for the Audio sub-item `paddle-hit`: a short cue plays when
// the ball strikes a paddle.
//
// Audio is synthesized with the Web Audio API (flow.md), so the driver reports every
// source the build starts (see `api.audio`). Audio is armed with one neutral key
// press first, because the game must not autoplay before the player interacts. A real
// paddle contact is then driven, and the audio log must grow across it — the build
// played a cue. Nothing here inspects the sound itself; only that one was scheduled
// in response to the hit.

import {
  arrangePaddleHit,
  actPaddleHit,
  startPlaying,
  armAudio,
} from "../_helpers.mjs";

export default function item() {
  let before;
  let hit;
  let after;

  return {
    id: "audio.paddle-hit",

    async arrange(api) {
      await startPlaying(api, "versus");
      await armAudio(api);
      await arrangePaddleHit(api, "left", { cy: 360, vy: 0, ballY: 360 });
    },

    async act(api) {
      before = (await api.audio()).length;
      hit = await actPaddleHit(api, "left");
      after = (await api.audio()).length;
      await api.advance(60); // a short tail so the clip shows the return
    },

    async assert(api, check) {
      check.expectOk("the ball strikes the paddle", hit.hit);
      check.expectGt(
        "a cue is played on the paddle hit (Web Audio sources started)",
        after,
        before,
      );
    },
  };
}
