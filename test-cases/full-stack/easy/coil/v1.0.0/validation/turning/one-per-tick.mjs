// Automated validation for the Turning sub-item `one-per-tick`.
//
// At most one buffered turn is applied per tick, so a rapid double-press cannot fold
// the snake onto itself. Moving right, two perpendicular turns (down then left) are
// injected through the real key handling within one tick; the first tick applies
// down and the second applies left, and the snake never dies. The snake is posed
// moving right (a precondition); the outcome is read back after each real tick.
//
// The pose and both presses are instant — and the presses MUST land with no tick
// between them, which is precisely what `arrange` guarantees. `act` is the two ticks
// that drain the buffer one turn at a time.

import { actPlayOn, hLane, PARK_PELLET, beginRound } from "../_helpers.mjs";

// After the two turns the head is at (9,9) heading LEFT, with the wall at col 0: cap
// the tail at 6 ticks (col 3) so the clip does not end in a wall death, which would
// misread as a failure of the very "never folded onto itself" point being made.
const HOLD_TICKS = 6;

export default function item() {
  // The state after each of the two ticks.
  let s1;
  let s2;

  return {
    id: "turning.one-per-tick",

    async arrange(api) {
      await beginRound(api);
      await api.call("setSnake", hLane(10, 8, 3), "right");
      await api.call("setPellet", PARK_PELLET);

      // Two turns queued within one tick — no tick between them.
      await api.call("press", "ArrowDown");
      await api.call("press", "ArrowLeft");
    },

    async act(api) {
      await api.advance(1); // first tick: down applied
      s1 = await api.snapshot();

      await api.advance(1); // second tick: left applied
      s2 = await api.snapshot();

      await actPlayOn(api, HOLD_TICKS);
    },

    async assert(api, check) {
      check.expectEq(
        "the first tick applies the first turn (down)",
        s1.dir,
        "down",
      );
      check.expectEq("the head moved down (row)", s1.snake[0].row, 9);
      check.expectEq("still live after the first turn", s1.ended, false);

      check.expectEq(
        "the second tick applies the second turn (left)",
        s2.dir,
        "left",
      );
      check.expectEq("the head moved left (col)", s2.snake[0].col, 9);
      check.expectEq(
        "the snake never folded onto itself (still live)",
        s2.ended,
        false,
      );
    },
  };
}
