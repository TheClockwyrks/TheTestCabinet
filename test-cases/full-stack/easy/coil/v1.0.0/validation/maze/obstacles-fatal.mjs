// Automated validation for the Maze sub-item `obstacles-fatal`.
//
// The head advancing into an interior obstacle cell ends the round immediately as a
// death, exactly like a wall. The snake is posed one cell from an obstacle facing it
// (a precondition — bar 1 sits along row 4, so a head at (8,5) facing up runs into the
// obstacle at (8,4)); one real tick resolves the collision and the end state is read
// back.
//
// The pose is instant (`arrange`); the single fatal tick is the only timed part and is
// therefore the clip. (The old clip tail posed the head two cells further back so it
// could be seen running in — a different scenario from the one the assertions drove,
// which asserts the head is still on row 5, so per the migration rules it is gone.)

import { actPlayOn, vLaneUp, beginRound } from "../_helpers.mjs";

// The round ends on the first tick; hold on the game-over panel for a beat (8 ticks =
// 1 s). The round is over, so these ticks advance nothing.
const HOLD_TICKS = 8;

export default function item() {
  // The state `act` read back after the fatal tick, checked by `assert`.
  let s;

  return {
    id: "maze.obstacles-fatal",

    async arrange(api) {
      await beginRound(api);
      // Head at (8,5) facing up; the cell above, (8,4), is a fixed obstacle (bar 1).
      await api.call("setSnake", vLaneUp(8, 5, 3), "up");
      await api.call("setPellet", { col: 25, row: 8 }); // far away — irrelevant to the hit
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
      check.expectEq(
        "the head did not move into the obstacle",
        s.snake[0].row,
        5,
      );
    },
  };
}
