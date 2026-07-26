// Automated validation for the Audio item `eat`: a short cue plays when a pellet is
// eaten. Audio is the produced .wav played through the Web Audio API (specs/assets.md),
// so the driver reports every source the build starts (see `api.audio`). The snake is
// posed in a clear lane, audio is armed with a real gesture, and the real eat logic is
// stepped so the pellet is eaten; the audio log must grow across the eat. Nothing here
// inspects the sound itself; only that one was scheduled in response to the eat.
//
// Arming triggers audio.ts's first-gesture handler, which fetches and decodes the
// produced .wav clips asynchronously (real wall-clock work) before any cue can
// actually play — a build that eats the instant it is armed would find no buffer
// decoded yet and play nothing, though it is fully conformant. So `arrange` ends
// with a real `api.settle` (not `api.advance`, which is instant in the validate
// pass) after arming, giving that decode time to land before the eat is driven.

import {
  actPlayOn,
  armAudio,
  audioCount,
  arrangeEatLane,
  beginRound,
} from "../_helpers.mjs";

// After the asserted eat the head is at col 4 with a 4-cell snake. Hold on a beat so
// the clip reads as an eat rather than a single flicker; 10 more ticks stays well
// clear of the wall.
const HOLD_TICKS = 10;

// Real wall-clock time for the first-gesture resume() to fetch and decode the
// produced .wav clips (specs/assets.md) before the eat is driven.
const ARM_SETTLE_MS = 300;

export default function item() {
  let before;
  let after;
  let startLength;
  let ateLength;

  return {
    id: "audio.eat",

    async arrange(api) {
      await beginRound(api);
      await arrangeEatLane(api); // a clear lane, head at col 3, facing right
      startLength = (await api.snapshot()).length;
      await armAudio(api);
      await api.settle(ARM_SETTLE_MS);
    },

    async act(api) {
      const head = (await api.snapshot()).snake[0];
      await api.call("setPellet", { col: head.col + 1, row: head.row }); // one cell ahead
      before = await audioCount(api);
      await api.advance(1); // 1 tick = the old step(TICK_DT); the head eats the pellet
      ateLength = (await api.snapshot()).length;
      after = await audioCount(api);
      await actPlayOn(api, HOLD_TICKS);
    },

    async assert(api, check) {
      check.expectGt("the snake ate (grew by one)", ateLength, startLength);
      check.expectGt(
        "an eat cue plays on the eat (Web Audio sources started)",
        after,
        before,
      );
    },
  };
}
