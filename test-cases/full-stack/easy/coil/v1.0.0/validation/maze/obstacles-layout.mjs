// Automated validation for the Maze sub-item `obstacles-layout`.
//
// The board carries the fixed course of interior obstacle cells, point-symmetric about
// the board center, with the snake's start row left clear. The obstacle set is read
// straight from the snapshot and checked: it is the expected fixed course, every cell's
// point-symmetric partner (col,row) -> (29-col, 17-row) is also present, and no obstacle
// lies on the start row. The board is captured so a reviewer sees the drawn course.

import {
  MAZE_OBSTACLES,
  cellKey,
  COLS,
  ROWS,
  START_ROW,
  beginRound,
} from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("maze.obstacles-layout");

  await beginRound(api);
  const s = await api.snapshot();
  const obstacles = s.obstacles || [];
  const set = new Set(obstacles.map(cellKey));

  check.expectEq("the mode is maze", s.mode, "maze");
  check.expectEq("the obstacle count matches the fixed course", obstacles.length, MAZE_OBSTACLES.length);

  const expected = new Set(MAZE_OBSTACLES.map(cellKey));
  const matchesExpected =
    set.size === expected.size && [...expected].every((k) => set.has(k));
  check.expectOk("the obstacle set is exactly the fixed course", matchesExpected);

  const symmetric = obstacles.every((o) =>
    set.has(cellKey({ col: COLS - 1 - o.col, row: ROWS - 1 - o.row })),
  );
  check.expectOk("the course is point-symmetric about the board center", symmetric);

  const startRowClear = obstacles.every((o) => o.row !== START_ROW);
  check.expectOk("the snake's start row is left clear of obstacles", startRowClear);

  await api.wait(150);
  await api.screenshot("layout");
  return check.verdict();
}
