// Automated validation for the Collision sub-item `tail-follow-safe`.
//
// On a normal (non-growth) tick the head may safely enter the cell the tail is
// vacating that tick, so the snake can chase its own tail without dying. The snake is
// posed as a loop whose head, on a normal tick, advances into the current tail cell
// (a precondition); one real tick resolves it and the outcome is read back — the
// round must NOT end, and the head must have taken the old tail cell.
//
// The pose is instant (`arrange`); the tick that resolves the follow is the only timed
// part, so it is the clip.

import { actPlayOn, sameCell, beginRound } from "../_helpers.mjs";

// The follow resolves in one tick. Keep chasing for a beat afterwards so the clip
// reads as a snake circling its own tail rather than a single frame. The outcome the
// assertions read has already been captured, so this cannot move a verdict; the loop
// keeps the snake in the middle of the board, well clear of every wall.
const HOLD_TICKS = 8;

export default function item() {
  // The state `act` read back after the tail-follow tick, checked by `assert`.
  let s;

  return {
    id: "collision.tail-follow-safe",

    async arrange(api) {
      await beginRound(api);
      // Facing right, the head at (10,8) advances into (11,8), which is the CURRENT tail.
      const snake = [
        { col: 10, row: 8 }, // head; steps right into (11,8)
        { col: 10, row: 9 },
        { col: 11, row: 9 },
        { col: 11, row: 8 }, // tail — vacates this tick, so the head may safely follow
      ];
      await api.call("setSnake", snake, "right");
      await api.call("setPellet", { col: 5, row: 1 }); // far away — a normal (non-growth) tick
    },

    async act(api) {
      await api.advance(1); // 1 tick = the old step(TICK_DT)
      s = await api.snapshot();
      await actPlayOn(api, HOLD_TICKS);
    },

    async assert(api, check) {
      check.expectEq(
        "the round did NOT end (tail-follow is safe)",
        s.ended,
        false,
      );
      check.expectEq("the screen is still playing", s.screen, "playing");
      check.expectOk(
        "the head took the old tail cell (11,8)",
        sameCell(s.snake[0], { col: 11, row: 8 }),
      );
      check.expectEq("the snake did not grow", s.length, 4);
    },
  };
}
