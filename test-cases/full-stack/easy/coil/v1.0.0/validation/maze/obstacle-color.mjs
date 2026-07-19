// Automated validation for the Maze sub-item `obstacle-color`.
//
// The interior obstacles are drawn in a distinct, visible color. The check samples the
// pixels the build actually RENDERS at an obstacle cell (bar 1, at (8,4)), a snake body
// cell, and an empty board patch. The obstacle must stand clearly apart from the board
// background (so it is visible) and from the snake (so it is not mistaken for a body
// segment). The exact hue is the model's own; only the distinctness is scored.

import {
  poseColorScene,
  sampleCell,
  colorDistance,
  SCENE_CELLS,
  VISIBLE_MIN,
  DISTINCT_MIN,
} from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("maze.obstacle-color");

  await poseColorScene(api);
  const obstacle = await sampleCell(api, SCENE_CELLS.obstacle.col, SCENE_CELLS.obstacle.row);
  const body = await sampleCell(api, SCENE_CELLS.body.col, SCENE_CELLS.body.row);
  const bg = await sampleCell(api, SCENE_CELLS.background.col, SCENE_CELLS.background.row);

  check.expectGt("the obstacle is a visible color, distinct from the board", colorDistance(obstacle, bg), VISIBLE_MIN);
  check.expectGt("the obstacle is distinct from the snake", colorDistance(obstacle, body), DISTINCT_MIN);

  await api.screenshot("scene");
  return check.verdict();
}
