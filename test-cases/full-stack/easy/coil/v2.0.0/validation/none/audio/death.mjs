// Automated validation for the Audio item `death`: a distinct sound plays when the
// snake dies. Audio is read from the Web Audio sources the build starts (see
// `api.audio`). The snake is posed one cell from a wall facing it (the same
// precondition as `collision.wall-fatal`), audio is armed with a real gesture, and
// the real collision logic is stepped so the fatal hit resolves; the audio log must
// grow across the death.
//
// Arming triggers audio.ts's first-gesture handler, which fetches and decodes the
// produced .wav clips asynchronously (real wall-clock work) before any cue can
// actually play. So `arrange` ends with a real `api.settle` (not `api.advance`,
// which is instant in the validate pass) after arming, giving that decode time to
// land before the fatal hit is driven.

import {
  actPlayOn,
  armAudio,
  audioCount,
  hLane,
  beginRound,
} from "../_helpers.mjs";

// The round ends on the fatal tick, so hold on the game-over panel for a beat; these
// ticks advance nothing and cannot move the verdict.
const HOLD_TICKS = 8;

// Real wall-clock time for the first-gesture resume() to fetch and decode the
// produced .wav clips (specs/assets.md) before the fatal hit is driven.
const ARM_SETTLE_MS = 300;

export default function item() {
  let before;
  let after;
  let s;

  return {
    id: "audio.death",

    async arrange(api) {
      await beginRound(api);
      // Head at (28, 8) = the last interior column; facing right into the wall at col 29.
      await api.call("setSnake", hLane(28, 8, 3), "right");
      await api.call("setPellet", { col: 5, row: 1 }); // far away — irrelevant to the hit
      await armAudio(api);
      await api.settle(ARM_SETTLE_MS);
    },

    async act(api) {
      before = await audioCount(api);
      await api.advance(1); // 1 tick = the old step(TICK_DT); the head hits the wall
      s = await api.snapshot();
      after = await audioCount(api);
      await actPlayOn(api, HOLD_TICKS);
    },

    async assert(api, check) {
      check.expectEq("the fatal hit ended the round", s.ended, true);
      check.expectEq("the end reason is death", s.endReason, "dead");
      check.expectGt(
        "a death cue plays on the fatal collision (Web Audio sources started)",
        after,
        before,
      );
    },
  };
}
