// Automated validation for the Audio item `combo-up`: a brighter cue plays when the
// combo multiplier increases. Audio is read from the Web Audio sources the build
// starts (see `api.audio`). The snake eats twice in a clear lane, one tick apart: the
// first eat opens the combo window at x1 (no rise, not the cue under test), and the
// second eat — still inside the window — climbs the multiplier to x2. Audio is armed
// once up front, then the log is read only across the second eat, so the growth
// asserted belongs to the combo-up event, not the first eat's own cue.
//
// Arming triggers audio.ts's first-gesture handler, which fetches and decodes the
// produced .wav clips asynchronously (real wall-clock work) before any cue can
// actually play. So `arrange` ends with a real `api.settle` (not `api.advance`,
// which is instant in the validate pass) after arming, giving that decode time to
// land before either eat is driven.

import {
  actPlayOn,
  armAudio,
  audioCount,
  arrangeEatLane,
  beginRound,
} from "../_helpers.mjs";

// After the two eats the head is at col 5 with a 5-cell snake; 10 more ticks stays
// well clear of the wall while the clip reads as a short rally.
const HOLD_TICKS = 10;

// Real wall-clock time for the first-gesture resume() to fetch and decode the
// produced .wav clips (specs/assets.md) before either eat is driven.
const ARM_SETTLE_MS = 300;

export default function item() {
  let before;
  let after;
  let combo;

  return {
    id: "audio.combo-up",

    async arrange(api) {
      await beginRound(api);
      await arrangeEatLane(api); // a clear lane, head at col 3, facing right
      await armAudio(api);
      await api.settle(ARM_SETTLE_MS);
    },

    async act(api) {
      // First eat: opens the combo window at x1 — no rise, so it is not the event
      // under test and is driven before the audio log is read.
      const head1 = (await api.snapshot()).snake[0];
      await api.call("setPellet", { col: head1.col + 1, row: head1.row });
      await api.advance(1); // 1 tick = the old step(TICK_DT)

      // Second eat, still inside the open window: the multiplier climbs — the
      // combo-up event this item checks.
      const head2 = (await api.snapshot()).snake[0];
      await api.call("setPellet", { col: head2.col + 1, row: head2.row });
      before = await audioCount(api);
      await api.advance(1);
      combo = (await api.snapshot()).combo;
      after = await audioCount(api);

      await actPlayOn(api, HOLD_TICKS);
    },

    async assert(api, check) {
      check.expectEq(
        "the second quick eat raises the multiplier to x2",
        combo,
        2,
      );
      check.expectGt(
        "a combo-up cue plays as the multiplier rises (Web Audio sources started)",
        after,
        before,
      );
    },
  };
}
