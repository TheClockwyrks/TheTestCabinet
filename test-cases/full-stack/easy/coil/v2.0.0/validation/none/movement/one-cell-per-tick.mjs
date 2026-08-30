// Automated validation for the Movement sub-item `one-cell-per-tick`.
//
// Each fixed tick advances the head exactly one cell in the direction it faces, and
// every following segment takes the cell ahead of it. The snake is posed in a clear
// horizontal lane (a precondition); one real tick runs it forward and the snapshot
// reads back where each segment landed. The unit is now whole ticks, so one advance is
// exactly one tick.
//
// The pose is instant (`arrange`); the single tick is the only timed part and is
// therefore the clip.

import { actPlayOn, hLane, PARK_PELLET, beginRound } from "../_helpers.mjs";

// One tick is 125 ms, too short to read on camera. Keep the same snake running for a
// beat afterwards so the clip shows the cell-by-cell march the assertions measured; the
// head is at col 11 with 17 clear columns ahead, so 10 ticks cannot end the round, and
// the asserted state is already captured.
const HOLD_TICKS = 10;

export default function item() {
  // The head column before the tick, and the state after it.
  let beforeCol;
  let s;

  return {
    id: "movement.one-cell-per-tick",

    async arrange(api) {
      await beginRound(api);
      await api.call("setSnake", hLane(10, 8, 3), "right"); // head (10,8), body (9,8),(8,8)
      await api.call("setPellet", PARK_PELLET); // parked far — no eat this tick
      beforeCol = (await api.snapshot()).snake[0].col;
    },

    async act(api) {
      await api.advance(1); // exactly one tick (the old step(TICK_DT))
      s = await api.snapshot();
      await actPlayOn(api, HOLD_TICKS);
    },

    async assert(api, check) {
      check.expectEq("head starts at col 10", beforeCol, 10);

      check.expectEq(
        "the head advanced exactly one cell (col)",
        s.snake[0].col,
        11,
      );
      check.expectEq("the head stayed on its row", s.snake[0].row, 8);
      check.expectEq(
        "the second segment took the head's old cell",
        s.snake[1].col,
        10,
      );
      check.expectEq(
        "the third segment took the second's old cell",
        s.snake[2].col,
        9,
      );
      check.expectEq("the snake did not grow (no eat)", s.length, 3);
      check.expectEq("the round is still live", s.ended, false);
    },
  };
}
