// Automated validation for the Combo sub-item `caps`.
//
// The multiplier never exceeds x5. The multiplier is set to x5 with an open window as
// a precondition (setCombo), the snake is posed in a clear lane, it runs for a beat,
// and then one real eat resolves — the real combo code, not the precondition, decides
// the result, which must stay x5.
//
// The preconditions are control ops, so the pose is `arrange`; the run-in and the eat
// are `act`, so the clip opens on a snake already carrying x5 and a reviewer sees the
// multiplier hold across an eat rather than finding the eat already over. (The old clip
// tail filmed a fresh 3-cell snake at the far left of the lane — a DIFFERENT scenario
// from the one the assertions drove — so per the migration rules it is gone; the
// run-in here is the same scenario, extended backwards.)

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

// A second of run-in before the eat. The window is what constrains it: `setCombo` opens
// a 3.5 s one and plain ticks drain it, so the lead-in has to leave enough of it to eat
// inside — 8 ticks spend 1 s and leave 2.5 s, and the assertion below reads the window
// back rather than trusting that arithmetic.
const LEAD_TICKS = 8;

// The head is at col 10, so the run-in and the eat leave it at col 19. Keep playing for
// a beat so the capped multiplier is legible on camera; 6 ticks stop at col 25, clear
// of the wall at col 29. Lower than the old 10, which was chosen when the eat landed on
// the first tick and there were 17 columns still ahead.
const HOLD_TICKS = 6;

export default function item() {
  // The multiplier `arrange` posed, the window still open at the eat, and the state
  // read back after it.
  let posedCombo;
  let windowAtEat;
  let s;

  return {
    id: "combo.caps",

    async arrange(api) {
      await beginRound(api);
      await api.call("setSnake", hLane(10, 8, 3), "right");
      // Off the lane for the run-in; `actEatSequence` places the real one ahead of the
      // head once the snake has been seen running.
      await api.call("setPellet", PARK_PELLET);
      // COMBO_WINDOW stays in SECONDS: setCombo poses the window, it does not advance
      // time, so it is not a tick count.
      await api.call("setCombo", 5, COMBO_WINDOW); // already at the cap, window open
      posedCombo = (await api.snapshot()).combo;
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
      check.expectEq(
        "the precondition set the multiplier to x5",
        posedCombo,
        5,
      );
      // The cap is only being tested if the eat lands inside an open window — an eat
      // after it lapsed would legitimately reset to x1, and reading x5 out of a lapsed
      // window would mean something else entirely.
      check.expectGt(
        "the run-in left the combo window open for the eat",
        windowAtEat,
        TICK_SECONDS,
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
