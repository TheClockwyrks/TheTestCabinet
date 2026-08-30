// Automated validation for the Combo sub-item `scoring`.
//
// Each pellet scores 10 x M using the multiplier AFTER this eat raises it. From score
// 0 at x3 with an open window (both set as preconditions), the snake runs a clear lane
// for a beat and then one real eat within the window raises the multiplier to x4 and
// scores 10 x 4 = 40; the multiplier and score are read back from the real tick.
//
// The preconditions are control ops, so the pose is `arrange`; the run-in and the eat
// are `act`, so the clip opens on the HUD already reading x3 and score 0 and a reviewer
// watches both change on the eat — which is the whole point of the item, and is
// invisible if the recording starts after it has happened.

import {
  actEatSequence,
  actLeadIn,
  actPlayOn,
  hLane,
  beginRound,
  PARK_PELLET,
  COMBO_WINDOW,
  TICK_SECONDS,
} from "../_helpers.mjs";

// A second of run-in before the eat. `setCombo` opens a 3.5 s window and plain ticks
// drain it, so this has to leave enough of it to eat inside: 8 ticks spend 1 s and
// leave 2.5 s, and the assertion below reads the window back rather than trusting that.
const LEAD_TICKS = 8;

// The head is at col 10, so the run-in and the eat leave it at col 19. Play on for a
// beat so the score and multiplier are legible on camera; 6 ticks stop at col 25, clear
// of the wall at col 29. Lower than the old 10, which was chosen when the eat landed on
// the first tick.
const HOLD_TICKS = 6;

export default function item() {
  // The window still open at the eat, and the state read back after it.
  let windowAtEat;
  let s;

  return {
    id: "combo.scoring",

    async arrange(api) {
      await beginRound(api);
      await api.call("setSnake", hLane(10, 8, 3), "right");
      // Off the lane for the run-in; `actEatSequence` places the real one ahead of the
      // head once the snake has been seen running.
      await api.call("setPellet", PARK_PELLET);
      await api.call("setScore", 0);
      // COMBO_WINDOW stays in SECONDS: setCombo poses the window rather than advancing
      // time, so it is not converted to ticks.
      await api.call("setCombo", 3, COMBO_WINDOW); // x3, window open
    },

    async act(api) {
      await actLeadIn(api, LEAD_TICKS);
      windowAtEat = (await api.snapshot()).comboWindow;

      ({
        snaps: [s],
      } = await actEatSequence(api, { count: 1 }));
      await actPlayOn(api, HOLD_TICKS);
    },

    async assert(api, check) {
      // The x3 -> x4 climb only happens inside an open window; an eat after it lapsed
      // would correctly score 10 x 1, so the window has to be shown to still be open or
      // a failure here would be unreadable.
      check.expectGt(
        "the run-in left the combo window open for the eat",
        windowAtEat,
        TICK_SECONDS,
      );
      check.expectEq("the eat raised the multiplier to x4", s.combo, 4);
      check.expectEq(
        "the pellet scored 10 x 4 = 40 (updated multiplier)",
        s.score,
        40,
      );
    },
  };
}
