// Automated validation for the Movement sub-item `no-speedup-when-long`.
//
// A long snake advances at the same fixed rate as a short one — growth never speeds
// the tick up. A 30-cell snake is posed in a clear lane (a precondition), then one
// second is advanced; it must advance exactly eight cells, the same as a length-3
// snake would.
//
// The pose is instant (`arrange`); the second of travel is the only timed part, so the
// clip is the long snake crossing exactly eight cells — which is the comparison the
// item makes. (The old clip tail re-posed a second long snake and filmed that instead.)

import {
  actPlayOn,
  makeLongSnake,
  PARK_PELLET,
  beginRound,
} from "../_helpers.mjs";

// One second of game time. The old script wrote step(1.0) in SECONDS; at 8 Hz that is
// exactly 8 ticks. The assertion below still reads "one second is still exactly eight
// ticks", which the tick unit now makes self-evident.
const ONE_SECOND_TICKS = 8;

// makeLongSnake guarantees only the eight cells ahead of the head (row 1, cols 9..16),
// which the measured second consumes exactly. Row 1 stays clear out to the wall at col
// 29, so a further 8 ticks reach col 24 without a collision, and every asserted value
// has already been read.
const HOLD_TICKS = 8;

export default function item() {
  // The posed long snake, the state before the measured second, and the state after.
  const long = makeLongSnake();
  let before;
  let s;

  return {
    id: "movement.no-speedup-when-long",

    async arrange(api) {
      await beginRound(api);
      await api.call("setSnake", long.snake, long.dir);
      await api.call("setPellet", PARK_PELLET);
      before = await api.snapshot();
    },

    async act(api) {
      await api.advance(ONE_SECOND_TICKS); // one second of game time
      s = await api.snapshot();
      await actPlayOn(api, HOLD_TICKS);
    },

    async assert(api, check) {
      check.expectEq("the posed snake is 30 cells long", before.length, 30);
      check.expectEq(
        "the head starts at col 8",
        before.snake[0].col,
        long.headCol,
      );

      check.expectEq("one second is still exactly eight ticks", s.ticks, 8);
      check.expectEq(
        "the long snake advanced exactly eight cells (no speed-up)",
        s.snake[0].col,
        long.headCol + long.advance, // 8 + 8 = 16
      );
      check.expectEq("the snake is still 30 cells long", s.length, 30);
      check.expectEq("the round is still live", s.ended, false);
    },
  };
}
