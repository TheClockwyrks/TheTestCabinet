// Automated validation for the Combo sub-item `scoring`.
//
// Each pellet scores 10 x M using the multiplier AFTER this eat raises it. From score
// 0 at x3 with an open window (both set as preconditions), one real eat within the
// window raises the multiplier to x4 and scores 10 x 4 = 40; the multiplier and score
// are read back from the real tick.
//
// Every precondition is a control op, so the pose is `arrange`; the single eat tick is
// the only timed part and is therefore the clip.

import { actPlayOn, hLane, beginRound, COMBO_WINDOW } from "../_helpers.mjs";

// The eat resolves in one tick. Play on for a beat so the score and multiplier are
// legible on camera; the head is at col 11 facing right with 17 clear columns ahead,
// so 10 ticks cannot end the round, and the asserted state is already captured.
const HOLD_TICKS = 10;

export default function item() {
  // The state `act` read back after the eat, checked by `assert`.
  let s;

  return {
    id: "combo.scoring",

    async arrange(api) {
      await beginRound(api);
      await api.call("setSnake", hLane(10, 8, 3), "right");
      await api.call("setPellet", { col: 11, row: 8 }); // one cell ahead
      await api.call("setScore", 0);
      // COMBO_WINDOW stays in SECONDS: setCombo poses the window rather than advancing
      // time, so it is not converted to ticks.
      await api.call("setCombo", 3, COMBO_WINDOW); // x3, window open
    },

    async act(api) {
      await api.advance(1); // 1 tick = the old step(TICK_DT); eat within the window
      s = await api.snapshot();
      await actPlayOn(api, HOLD_TICKS);
    },

    async assert(api, check) {
      check.expectEq("the eat raised the multiplier to x4", s.combo, 4);
      check.expectEq(
        "the pellet scored 10 x 4 = 40 (updated multiplier)",
        s.score,
        40,
      );
    },
  };
}
