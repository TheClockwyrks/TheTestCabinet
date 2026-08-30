// Automated validation for the Movement sub-item `constant-rate`.
//
// The snake advances at a constant 8 ticks per second: one second of game time is
// exactly eight ticks and eight cells of head travel. The snake is posed in a clear
// lane (a precondition), then exactly one second is advanced — 8 ticks, the unit the
// debug API now takes, so the count can never be silently rounded — and the tick count
// and head displacement are read back.
//
// The pose is instant (`arrange`); the second of travel is the only timed part and is
// therefore the clip — a snake crossing eight cells in a second, at the speed the game
// really moves.

import { actPlayOn, hLane, PARK_PELLET, beginRound } from "../_helpers.mjs";

// One second of game time. The old script wrote step(1.0) in SECONDS; at 8 Hz that is
// exactly 8 ticks, and the assertion below still reads "one second is exactly eight
// ticks".
const ONE_SECOND_TICKS = 8;

// After the measured second the head is at col 13; 10 more ticks reach col 23, five
// columns clear of the wall, so the clip can run on without the round ending.
const HOLD_TICKS = 10;

export default function item() {
  // The tick count before the measured second, and the state after it.
  let t0;
  let s;

  return {
    id: "movement.constant-rate",

    async arrange(api) {
      await beginRound(api);
      await api.call("setSnake", hLane(5, 8, 3), "right"); // head (5,8)
      await api.call("setPellet", PARK_PELLET);
      t0 = (await api.snapshot()).ticks;
    },

    async act(api) {
      await api.advance(ONE_SECOND_TICKS); // one second of game time
      s = await api.snapshot();
      await actPlayOn(api, HOLD_TICKS);
    },

    async assert(api, check) {
      check.expectEq("one second is exactly eight ticks", s.ticks - t0, 8);
      check.expectEq(
        "the head advanced exactly eight cells",
        s.snake[0].col,
        13,
      ); // 5 + 8
      check.expectEq("the head stayed on its row", s.snake[0].row, 8);
      check.expectEq("the snake did not grow (no eat)", s.length, 3);
      check.expectEq("the round is still live", s.ended, false);
    },
  };
}
