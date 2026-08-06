// Automated validation for the Collision sub-item `wall-fatal`.
//
// The head advancing into a wall cell ends the round immediately — that same tick,
// with no grace frame. The snake is posed facing the right wall with a clear run up to
// it (a precondition), runs that lane down, and on the arriving tick the head advances
// into the wall and the end state is read back. The snake must not have moved into the
// wall (a fatal tick ends before the head advances), so it is left standing on the last
// interior column.
//
// The run-in is filmed and is part of the CHECKED scenario. An earlier revision posed
// the snake flush against the wall so the death landed on the first tick, because a
// previous clip had staged a *different*, longer approach purely for the camera — the
// rule being that the clip must show what the assertions drove. Driving the approach
// itself satisfies both: the assertions below are written for a head that arrives at
// col 28 under its own steam, so what a reviewer watches is exactly what was scored.
//
// Immediacy is scored by WHAT the tick did, never by the snapshot's `ticks` counter.
// The seeded specification says only that `ticks` is "ticks elapsed in the current
// round" (specs/instrumentation.md) and that a fatal collision ends the round before
// steps 4-6 run (specs/movement.md); neither pins down whether the aborted tick is
// counted. A build that increments the counter only on a tick that completes is
// therefore just as correct as one that counts it up front, so asserting a value here
// would fail a spec-compliant build over an unstated convention. The sibling
// maze/obstacles-fatal.mjs scores the identical behavior the same way.
import {
  actLeadIn,
  actPlayOn,
  actAwait,
  hLane,
  beginRound,
  IN_COL1,
  LEAD_IN_TICKS,
} from "../_helpers.mjs";

// A full second of run-in, which fixes where the snake is posed: the head must end the
// approach on the last interior column, so it starts eight cells short of it. Row 8
// carries no obstacle in either variant, so the whole lane is clear.
const START_COL = IN_COL1 - LEAD_IN_TICKS; // 20

// The round ends on the arriving tick, so hold on the game-over panel for a beat (8
// ticks = 1 s). The round is over, so these ticks advance nothing and cannot move a
// verdict.
const HOLD_TICKS = 8;

export default function item() {
  // The state read back at the brink, and after the fatal tick.
  let atBrink;
  let s;

  return {
    id: "collision.wall-fatal",

    async arrange(api) {
      await beginRound(api);
      // Eight clear columns short of the wall at col 29, facing it.
      await api.call("setSnake", hLane(START_COL, 8, 3), "right");
      await api.call("setPellet", { col: 5, row: 1 }); // far away — irrelevant to the hit
    },

    async act(api) {
      // The approach, filmed: the snake runs the lane down to the last interior column.
      await actLeadIn(api);
      atBrink = await actAwait(api, (snap) => snap.snake[0].col >= IN_COL1);

      await api.advance(1); // the tick that runs the head into the wall
      s = await api.snapshot();
      await actPlayOn(api, HOLD_TICKS);
    },

    async assert(api, check) {
      // The approach has to have delivered the snake to the brink alive, or the death
      // below is not the wall hit this item is about.
      check.expectEq(
        "the approach ran the head to the last interior column",
        atBrink.snake[0].col,
        IN_COL1,
      );
      check.expectEq("...and the round was still live", atBrink.ended, false);

      check.expectEq("the round ended", s.ended, true);
      check.expectEq("the screen is game-over", s.screen, "gameover");
      check.expectEq("the end reason is death", s.endReason, "dead");
      check.expectEq(
        "the head did not move into the wall",
        s.snake[0].col,
        IN_COL1,
      );
    },
  };
}
