// Automated validation for the Maze sub-item `obstacles-layout`.
//
// The board carries the fixed course of interior obstacle cells, point-symmetric about
// the board center, with the snake's start row left clear. The obstacle set is read
// straight from the snapshot and checked: it is the expected fixed course, every cell's
// point-symmetric partner (col,row) -> (29-col, 17-row) is also present, and no obstacle
// lies on the start row. The board is captured so a reviewer sees the drawn course.
//
// Starting the round and reading the obstacle set are instant, so they are `arrange`;
// `act` is the settle the capture needs, so the still shows a drawn course rather than
// a blank first frame.

import {
  actSettleShot,
  MAZE_OBSTACLES,
  cellKey,
  COLS,
  ROWS,
  START_ROW,
  beginRound,
} from "../_helpers.mjs";

export default function item() {
  // The snapshot and its obstacle set, read in `arrange`.
  let s;
  let obstacles;

  return {
    id: "maze.obstacles-layout",

    async arrange(api) {
      await beginRound(api);
      s = await api.snapshot();
      obstacles = s.obstacles || [];
    },

    async act(api) {
      // settleMs 150 = the old trailing api.wait(150) before the capture.
      await actSettleShot(api, "layout", { settleMs: 150 });
    },

    async assert(api, check) {
      const set = new Set(obstacles.map(cellKey));

      check.expectEq("the mode is maze", s.mode, "maze");
      check.expectEq(
        "the obstacle count matches the fixed course",
        obstacles.length,
        MAZE_OBSTACLES.length,
      );

      const expected = new Set(MAZE_OBSTACLES.map(cellKey));
      const matchesExpected =
        set.size === expected.size && [...expected].every((k) => set.has(k));
      check.expectOk(
        "the obstacle set is exactly the fixed course",
        matchesExpected,
      );

      const symmetric = obstacles.every((o) =>
        set.has(cellKey({ col: COLS - 1 - o.col, row: ROWS - 1 - o.row })),
      );
      check.expectOk(
        "the course is point-symmetric about the board center",
        symmetric,
      );

      const startRowClear = obstacles.every((o) => o.row !== START_ROW);
      check.expectOk(
        "the snake's start row is left clear of obstacles",
        startRowClear,
      );
    },
  };
}
