// Automated validation for the Collision sub-item `wall-fatal`.
//
// The head advancing into a wall cell ends the round immediately — that same tick,
// with no grace frame. The snake is posed one cell from the right wall facing it (a
// precondition); one real tick runs the head into the wall and the end state is read
// back. The snake must not have moved (a fatal tick ends before the head advances).
//
// The pose stays flush against the wall because one assertion reads `s.ticks === 1` —
// the hit must land on the very first tick. (The old clip tail posed the snake four
// cells further back so it could be seen running in; that scenario is NOT what the
// assertions drove, so per the migration rules the clip now shows the checked one.)

import { actPlayOn, hLane, beginRound } from "../_helpers.mjs";

// The round ends on tick 1, so hold on the game-over panel for a beat (8 ticks = 1 s).
// The round is over, so these ticks advance nothing and cannot move a verdict.
const HOLD_TICKS = 8;

export default function item() {
  // The state `act` read back after the fatal tick, checked by `assert`.
  let s;

  return {
    id: "collision.wall-fatal",

    async arrange(api) {
      await beginRound(api);
      // Head at (28, 8) = the last interior column; facing right into the wall at col 29.
      await api.call("setSnake", hLane(28, 8, 3), "right");
      await api.call("setPellet", { col: 5, row: 1 }); // far away — irrelevant to the hit
    },

    async act(api) {
      await api.advance(1); // 1 tick = the old step(TICK_DT)
      s = await api.snapshot();
      await actPlayOn(api, HOLD_TICKS);
    },

    async assert(api, check) {
      check.expectEq("the round ended", s.ended, true);
      check.expectEq("the screen is game-over", s.screen, "gameover");
      check.expectEq("the end reason is death", s.endReason, "dead");
      check.expectEq("the head did not move into the wall", s.snake[0].col, 28);
      check.expectEq("it ended on the very first tick", s.ticks, 1);
    },
  };
}
