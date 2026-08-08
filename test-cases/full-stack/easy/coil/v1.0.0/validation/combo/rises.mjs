// Automated validation for the Combo sub-item `rises`.
//
// Eating pellets in quick succession, while the combo window is open, raises the
// multiplier by one per pellet. Four pellets are eaten one tick apart in a clear lane
// (each placed one cell ahead as a precondition, then a real tick runs the head into
// it); the multiplier after each real eat is read back. The first eat opens the window
// at x1; each subsequent eat within it climbs by one.
//
// The lane is posed instantly (`arrange`); the four eats consume time and are the clip
// — which is now the very climb the assertions read, where the old clip tail filmed an
// unrelated fresh snake.

import {
  actEatSequence,
  actLeadIn,
  actPlayOn,
  arrangeEatLane,
  beginRound,
  PARK_PELLET,
} from "../_helpers.mjs";

// A second of run-in before the first eat, so the clip opens on a snake crossing an
// empty lane and the rally reads as something that starts rather than as the state the
// recording happens to begin in. It costs the climb nothing: the combo starts at x1
// with its window shut, and plain ticks neither open a window nor raise a multiplier,
// so the first eat below is still the one that opens it.
const LEAD_TICKS = 8;

// The four eats take four ticks (0.5 s). Play on for a beat so the run reads as a
// rally rather than a flicker; after the run-in and four eats the head is at col 15
// with the snake 7 cells long, so 10 more ticks stay well clear of the right wall.
const HOLD_TICKS = 10;

export default function item() {
  // The per-eat multipliers `act` read back, checked by `assert`.
  let combos;

  return {
    id: "combo.rises",

    async arrange(api) {
      await beginRound(api);
      await arrangeEatLane(api); // the old opening setSnake(hLane(3, 8, 3), "right")
      // The round's own first pellet is placed wherever the build's spawn put it,
      // which may be anywhere in the lane. Park it: the run-in below crosses that lane,
      // and a stray eat on the way would open the combo window before the sequence
      // starts, so `combos[0]` would read x2 for a perfectly correct build.
      await api.call("setPellet", PARK_PELLET);
    },

    async act(api) {
      await actLeadIn(api, LEAD_TICKS);
      ({ combos } = await actEatSequence(api, { count: 4 }));
      await actPlayOn(api, HOLD_TICKS);
    },

    async assert(api, check) {
      check.expectEq("first eat (window opens) is x1", combos[0], 1);
      check.expectEq("second quick eat climbs to x2", combos[1], 2);
      check.expectEq("third quick eat climbs to x3", combos[2], 3);
      check.expectEq("fourth quick eat climbs to x4", combos[3], 4);
    },
  };
}
