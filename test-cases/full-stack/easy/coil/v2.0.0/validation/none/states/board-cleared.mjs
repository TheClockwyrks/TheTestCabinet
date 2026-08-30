// Automated validation for the Game States sub-item `board-cleared`.
//
// Filling the board so no new pellet can spawn ends the round cleanly on a BOARD
// CLEARED screen. The snake is posed occupying every free cell but one, with its head
// adjacent to that last free cell and the pellet on it (a precondition that works for
// both Classic and Maze — see buildFillSnake). One real tick eats there: the snake
// grows to fill every free cell and the real pellet spawn finds no cell left, ending
// the round CLEARED. What the check reads (the CLEARED end) resolves through the real
// tick, not the pose.
//
// buildFillSnake is a snapshot read plus a computation — no time — so the whole fill is
// posed in `arrange`; the single clearing tick and the settle the capture needs are
// `act`.

import {
  actPlayOn,
  actSettleShot,
  buildFillSnake,
  beginRound,
} from "../_helpers.mjs";

// The clear lands on the first tick; hold on the CLEARED panel for a beat (8 ticks =
// 1 s) after the capture. The round is over, so these ticks advance nothing.
const HOLD_TICKS = 8;

export default function item() {
  // The fill the round was posed with, the state before the last eat, and after it.
  let fill;
  let before;
  let s;

  return {
    id: "states.board-cleared",

    async arrange(api) {
      await beginRound(api);
      fill = await buildFillSnake(api);
      await api.call("setSnake", fill.snake, fill.dir);
      await api.call("setPellet", fill.pellet);
      before = await api.snapshot();
    },

    async act(api) {
      await api.advance(1); // 1 tick; eat the last free cell -> nothing left to spawn
      s = await api.snapshot();
      // settleMs 200 = the old trailing api.wait(200) before the capture.
      await actSettleShot(api, "cleared", { settleMs: 200 });
      await actPlayOn(api, HOLD_TICKS);
    },

    async assert(api, check) {
      check.expectEq(
        "the snake fills every free cell but one",
        before.length,
        fill.freeCount - 1,
      );
      check.expectEq(
        "the round is still live before the last eat",
        before.ended,
        false,
      );

      check.expectEq("the round ended", s.ended, true);
      check.expectEq(
        "it ended CLEARED, not as a death",
        s.endReason,
        "cleared",
      );
      check.expectEq(
        "the screen is the board-cleared screen",
        s.screen,
        "cleared",
      );
      check.expectEq(
        "no pellet remains once the board is cleared",
        s.pellet,
        null,
      );
    },
  };
}
