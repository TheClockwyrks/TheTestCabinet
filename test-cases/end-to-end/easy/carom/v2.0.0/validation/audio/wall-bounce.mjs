// Automated validation for the Audio sub-item `wall-bounce`: a short cue plays when
// the ball bounces off the side wall of the playfield (the top or bottom edge — the
// left and right edges are goals).
//
// Audio is armed with one neutral key press (the game must not autoplay), then the
// ball is fired straight into the top wall. The real collision reflects it and the
// audio log must grow across the bounce — the build played a cue. See
// validation/_helpers.mjs.

import {
  startPlaying,
  clearPaddles,
  armAudio,
  TICK,
  ball0,
} from "../_helpers.mjs";

export default function item() {
  let before;
  let bounced;
  let after;

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
      before = (await api.audio()).length;
      const r = await api.until((s) => ball0(s).vy > 0, {
        max: 120,
        poll: TICK,
      });
      bounced = r.hit;
      after = (await api.audio()).length;
      await api.advance(60); // a short tail so the clip shows the rebound
    },

    async assert(api, check) {
      check.expectOk(
        "the ball bounces off the top wall (vy reverses)",
        bounced,
      );
      check.expectGt(
        "a cue is played on the wall bounce (Web Audio sources started)",
        after,
        before,
      );
    },
  };
}
