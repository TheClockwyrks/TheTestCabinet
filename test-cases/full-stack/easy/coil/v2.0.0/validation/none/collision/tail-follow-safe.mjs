// Automated validation for the Collision sub-item `tail-follow-safe`.
//
// On a normal (non-growth) tick the head may safely enter the cell the tail is
// vacating that tick, so the snake can chase its own tail without dying. The snake is
// posed in the shared tail-chase lane (a precondition) with the head a clear run short
// of the corner its own tail is retracting toward; it runs that corridor down, and on
// the arriving tick the head takes the cell the tail leaves. The outcome is read back
// — the round must NOT end, and the head must hold the old tail cell.
//
// The pose is instant (`arrange`); the whole approach and the follow itself are `act`,
// so the clip opens on the snake set up in its lane and a reviewer watches the head
// close on the corner. That run-in is part of the CHECKED scenario, not a staged
// preamble in front of it: the follow only lands because the approach put the head and
// the tail on the same cell on the same tick (see the invariant on `tailChaseSnake`),
// so the assertions below are reading exactly what the camera saw.
import {
  actLeadIn,
  actPlayOn,
  sameCell,
  beginRound,
  tailChaseSnake,
  TAIL_CHASE_APPROACH,
  TAIL_CHASE_TARGET,
  PARK_PELLET,
} from "../_helpers.mjs";

// The lane runs the head from col 4 to col 11 and the follow leaves it there, heading
// right with 17 clear columns to the wall. Keep chasing for a beat afterwards so the
// clip reads as a snake that survived rather than a frozen frame; the outcome the
// assertions read has already been captured, so this cannot move a verdict.
const HOLD_TICKS = 8;

// A tail-follow is not a growth tick, so the length must be exactly what was posed —
// read from the pose itself rather than restated, so the two cannot drift apart.
const POSED_LENGTH = tailChaseSnake().length;

export default function item() {
  // The state read back on the tick before the follow, and after it.
  let beforeFollow;
  let s;

  return {
    id: "collision.tail-follow-safe",

    async arrange(api) {
      await beginRound(api);
      await api.call("setSnake", tailChaseSnake(), "right");
      await api.call("setPellet", PARK_PELLET); // far away — every tick here is normal
    },

    async act(api) {
      // The approach: one tick short of the corner, filmed.
      await actLeadIn(api, TAIL_CHASE_APPROACH - 1);
      beforeFollow = await api.snapshot();

      await api.advance(1); // the tick the head and the tail both want the corner
      s = await api.snapshot();
      await actPlayOn(api, HOLD_TICKS);
    },

    async assert(api, check) {
      // The approach has to have delivered the setup, or "it did not die" would be
      // true for the empty reason that nothing ever met at the corner.
      check.expectOk(
        `the approach left the tail on the corner ${JSON.stringify(TAIL_CHASE_TARGET)}, about to vacate it`,
        sameCell(
          beforeFollow.snake[beforeFollow.snake.length - 1],
          TAIL_CHASE_TARGET,
        ),
      );
      check.expectEq(
        "...and the round was still live going into it",
        beforeFollow.ended,
        false,
      );

      check.expectEq(
        "the round did NOT end (tail-follow is safe)",
        s.ended,
        false,
      );
      check.expectEq("the screen is still playing", s.screen, "playing");
      check.expectOk(
        `the head took the old tail cell ${JSON.stringify(TAIL_CHASE_TARGET)}`,
        sameCell(s.snake[0], TAIL_CHASE_TARGET),
      );
      check.expectEq("the snake did not grow", s.length, POSED_LENGTH);
    },
  };
}
