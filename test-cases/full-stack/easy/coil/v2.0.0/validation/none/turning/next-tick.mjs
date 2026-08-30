// Automated validation for the Turning sub-item `next-tick`.
//
// A requested turn does not move the snake immediately; the new direction is applied
// on the next tick. The snake is posed moving right (a precondition), runs on for a
// beat, a perpendicular turn is requested through the real key handling (press
// ArrowDown), the facing is read back BEFORE any further tick (still right), then one
// real tick is stepped and the facing and head are read back (now down).
//
// WHY THE PRESS IS IN `act`. The pose is instant and belongs in `arrange`, but the
// press cannot join it: a buffered turn is drained by the NEXT tick, so a press in
// `arrange` is spent by the first tick of the lead-in and there is no turn left to
// film. The press therefore follows the lead-in, inside `act` — the pattern the
// sibling `perpendicular-only` has always used. What `arrange` guaranteed for the
// "before any tick" reading is unchanged: it is the ABSENCE of a tick between the
// press and the read that makes it meaningful, and nothing advances between them
// here. (In the record pass the build drives its own clock, so that reading may catch
// the turn already applied — the record pass asserts nothing, and the verdict comes
// from the exact validate pass.)
import { actLeadIn, actPlayOn, hLane, PARK_PELLET, beginRound } from "../_helpers.mjs";

// Five ticks of run-in rather than the usual eight. The head starts at col 10 and
// then turns DOWN and descends its column, and in the Maze variant the obstacle bar
// at row 13 spans cols 16-21 (`MAZE_OBSTACLES`): a full eight-tick lead-in would put
// the turn at col 18 and drive the descent straight into it. Five leaves the head at
// col 15, clear of that bar and of the col-8 pillar, in both variants.
const LEAD_TICKS = 5;
// The column the lead-in leaves the head on, and so the column the turn happens in
// and the snake descends. Kept as a name because every assertion below reads it.
const TURN_COL = 10 + LEAD_TICKS; // 15

// The turn resolves in one tick. Keep running so the clip reads as a turn rather than
// a jump; the head is at (15,9) heading DOWN, and the interior ends at row 16, so cap
// the tail at 6 ticks (row 15) — 10 would run it into the bottom wall on camera and
// make the clip look like a death check.
const HOLD_TICKS = 6;

export default function item() {
  // The state read before the turn tick (with the turn already requested), and after.
  let beforeTick;
  let s;

  return {
    id: "turning.next-tick",

    async arrange(api) {
      await beginRound(api);
      await api.call("setSnake", hLane(10, 8, 3), "right");
      await api.call("setPellet", PARK_PELLET);
    },

    async act(api) {
      // Film the snake simply running, so the turn reads as a change rather than as
      // the first thing that happens. This is part of the checked scenario: the
      // assertions below are written for where it leaves the head.
      await actLeadIn(api, LEAD_TICKS);

      await api.call("press", "ArrowDown"); // request a turn (buffered for the next tick)
      beforeTick = await api.snapshot();

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
        TURN_COL,
      );

      check.expectEq("the turn is applied on the next tick", s.dir, "down");
      check.expectEq("the head advanced downward (row)", s.snake[0].row, 9);
      check.expectEq("the head stayed in its column", s.snake[0].col, TURN_COL);
    },
  };
}
