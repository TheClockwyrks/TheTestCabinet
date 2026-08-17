// Automated validation for the Turning sub-item `one-per-tick`.
//
// At most one buffered turn is applied per tick, so a rapid double-press cannot fold
// the snake onto itself. Moving right, the snake runs for a beat and then two
// perpendicular turns (down then left) are injected through the real key handling
// within one tick; the first tick applies down and the second applies left, and the
// snake never dies. The snake is posed moving right (a precondition); the outcome is
// read back after each real tick.
//
// The two presses MUST land with no tick between them. That is what `arrange` used to
// guarantee, but `arrange` cannot hold them any more: a lead-in has to run before the
// double-press for the fold — the thing this item says cannot happen — to be legible
// on camera, and the first tick of that run-in would drain the buffer. They sit
// together at the top of `act` instead, back to back with nothing between them, which
// is what the rule actually requires. In the VALIDATE pass, which decides the verdict,
// that is exact: the build is on its manual clock and only `advance` moves it, so no
// tick can fall between the two calls. (In the record pass the build drives its own
// clock and the pair may straddle a tick — down applies, then left applies one tick
// later, which is the same footage — and the record pass asserts nothing.)
import {
  actLeadIn,
  actPlayOn,
  hLane,
  PARK_PELLET,
  beginRound,
} from "../_helpers.mjs";

// A full second of run-in. After the two turns the snake heads LEFT along row 9,
// which carries no obstacle in either variant, and the descent is a single row, so
// the run-in spends only the columns it travels.
const LEAD_TICKS = 8;
const TURN_COL = 10 + LEAD_TICKS; // 18 — where the down turn happens
const HEAD_COL_AFTER = TURN_COL - 1; // 17 — one cell left of it, after the second turn

// After the two turns the head is at (17,9) heading LEFT, with the wall at col 0: cap
// the tail at 6 ticks (col 11) so the clip does not end in a wall death, which would
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
    },

    async act(api) {
      // Establish the motion the double-press is made against, so a reviewer can see
      // the snake was running straight when both keys landed.
      await actLeadIn(api, LEAD_TICKS);

      // Two turns queued within one tick — no tick between them.
      await api.call("press", "ArrowDown");
      await api.call("press", "ArrowLeft");

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
      check.expectEq("the head held its column", s1.snake[0].col, TURN_COL);
      check.expectEq("still live after the first turn", s1.ended, false);

      check.expectEq(
        "the second tick applies the second turn (left)",
        s2.dir,
        "left",
      );
      check.expectEq("the head moved left (col)", s2.snake[0].col, HEAD_COL_AFTER);
      check.expectEq(
        "the snake never folded onto itself (still live)",
        s2.ended,
        false,
      );
    },
  };
}
