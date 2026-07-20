// Automated validation for the Turning sub-item `reversal-ignored`.
//
// A request to reverse straight back into the neck (the opposite of the current
// direction) is ignored; the snake keeps moving the way it was. The snake is posed
// moving right (a precondition), a reversal (ArrowLeft) is injected through the real
// key handling, one real tick is stepped, and the facing and head are read back — the
// snake must still be moving right.
//
// The pose and the press are instant (`arrange`); the tick that proves the request was
// dropped is the only timed part, so it is the clip.

import { actPlayOn, hLane, PARK_PELLET, beginRound } from "../_helpers.mjs";

// The snake keeps heading right from col 11 with 17 clear columns to the wall, so 10
// ticks read as "it just carried on" without ending the round on camera.
const HOLD_TICKS = 10;

export default function item() {
  // The state after the tick that should have ignored the reversal.
  let s;

  return {
    id: "turning.reversal-ignored",

    async arrange(api) {
      await beginRound(api);
      await api.call("setSnake", hLane(10, 8, 3), "right");
      await api.call("setPellet", PARK_PELLET);

      await api.call("press", "ArrowLeft"); // a reversal back into the neck
    },

    async act(api) {
      await api.advance(1); // 1 tick = the old step(TICK_DT)
      s = await api.snapshot();
      await actPlayOn(api, HOLD_TICKS);
    },

    async assert(api, check) {
      check.expectEq(
        "the reversal is ignored — still moving right",
        s.dir,
        "right",
      );
      check.expectEq("the head continued right (col)", s.snake[0].col, 11);
      check.expectEq("the head stayed on its row", s.snake[0].row, 8);
      check.expectEq("the round is still live (no self-fold)", s.ended, false);
    },
  };
}
