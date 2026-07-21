// Automated validation for the Combo sub-item `caps`.
//
// The multiplier never exceeds x5. The multiplier is set to x5 with an open window as
// a precondition (setCombo), the snake is posed with a pellet one cell ahead, and one
// real tick runs the head into it — the real combo code, not the precondition, decides
// the result, which must stay x5.
//
// Every precondition is a control op, so the whole pose is `arrange`; the single eat
// tick is the only timed part and is therefore the clip. (The old clip tail filmed a
// fresh 3-cell snake at the far left of the lane — a DIFFERENT scenario from the one
// the assertions drove — so per the migration rules it is gone.)

import { actPlayOn, hLane, beginRound, COMBO_WINDOW } from "../_helpers.mjs";

// The eat resolves in one tick. Keep playing for a beat so the clip is readable; the
// head is at col 11 facing right with 17 clear columns before the wall, so 10 ticks
// cannot end the round. The asserted state has already been captured either way.
const HOLD_TICKS = 10;

export default function item() {
  // The multiplier `arrange` posed, and the state `act` read back after the eat.
  let posedCombo;
  let s;

  return {
    id: "combo.caps",

    async arrange(api) {
      await beginRound(api);
      await api.call("setSnake", hLane(10, 8, 3), "right");
      await api.call("setPellet", { col: 11, row: 8 }); // one cell ahead
      // COMBO_WINDOW stays in SECONDS: setCombo poses the window, it does not advance
      // time, so it is not a tick count.
      await api.call("setCombo", 5, COMBO_WINDOW); // already at the cap, window open
      posedCombo = (await api.snapshot()).combo;
    },

    async act(api) {
      await api.advance(1); // 1 tick = the old step(TICK_DT); eat while at x5
      s = await api.snapshot();
      await actPlayOn(api, HOLD_TICKS);
    },

    async assert(api, check) {
      check.expectEq(
        "the precondition set the multiplier to x5",
        posedCombo,
        5,
      );
      check.expectEq(
        "eating at x5 leaves the multiplier at x5 (capped)",
        s.combo,
        5,
      );
      check.expectEq("the eat still happened (snake grew)", s.length, 4);
    },
  };
}
