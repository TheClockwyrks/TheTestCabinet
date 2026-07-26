// Automated validation for the Turning sub-item `next-tick`.
//
// A requested turn does not move the snake immediately; the new direction is applied
// on the next tick. The snake is posed moving right (a precondition), a perpendicular
// turn is requested through the real key handling (press ArrowDown), the facing is
// read back BEFORE any tick (still right), then one real tick is stepped and the
// facing and head are read back (now down).
//
// The pose AND the press are instant, and the "before any tick" reading has to be taken
// with no time elapsed — so both belong in `arrange`, which is exactly the guarantee
// that makes that reading meaningful. `act` is the tick that applies the turn.

import { actPlayOn, hLane, PARK_PELLET, beginRound } from "../_helpers.mjs";

// The turn resolves in one tick. Keep running so the clip reads as a turn rather than
// a jump; the head is at (10,9) heading DOWN, and the interior ends at row 16, so cap
// the tail at 6 ticks (row 15) — 10 would run it into the bottom wall on camera and
// make the clip look like a death check.
const HOLD_TICKS = 6;

export default function item() {
  // The state read before any tick (with the turn already requested), and after it.
  let beforeTick;
  let s;

  return {
    id: "turning.next-tick",

    async arrange(api) {
      await beginRound(api);
      await api.call("setSnake", hLane(10, 8, 3), "right");
      await api.call("setPellet", PARK_PELLET);

      await api.call("press", "ArrowDown"); // request a turn (buffered for the next tick)
      beforeTick = await api.snapshot();
    },

    async act(api) {
      await api.advance(1); // one tick applies the buffered turn
      s = await api.snapshot();
      await actPlayOn(api, HOLD_TICKS);
    },

    async assert(api, check) {
      check.expectEq(
        "the facing is unchanged before a tick",
        beforeTick.dir,
        "right",
      );
      check.expectEq(
        "the head has not moved yet (col)",
        beforeTick.snake[0].col,
        10,
      );

      check.expectEq("the turn is applied on the next tick", s.dir, "down");
      check.expectEq("the head advanced downward (row)", s.snake[0].row, 9);
      check.expectEq("the head stayed in its column", s.snake[0].col, 10);
    },
  };
}
