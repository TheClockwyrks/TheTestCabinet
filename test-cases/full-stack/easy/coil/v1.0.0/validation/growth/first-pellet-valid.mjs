// Automated validation for the Growth & Pellets sub-item `first-pellet-valid`.
//
// The first pellet of a round spawns after the snake is placed, at an interior cell
// that does not overlap the starting body (and, in Maze, not on an obstacle). A
// seeded round is started and the first pellet — chosen by the real spawn code — is
// read straight back from the snapshot and checked.

import {
  isInterior,
  onSnake,
  cellKey,
  MAZE_OBSTACLES,
  beginRound,
} from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("growth.first-pellet-valid");

  await beginRound(api, 777);
  const s = await api.snapshot();
  const p = s.pellet;
  const maze = s.mode === "maze";
  const obstacleSet = new Set(MAZE_OBSTACLES.map(cellKey));

  check.expectNe("a first pellet was placed", p, null);
  check.expectOk("the first pellet is an interior cell", isInterior(p));
  check.expectOk("the first pellet is not on the starting body", !onSnake(p, s.snake));
  if (maze) {
    check.expectOk("the first pellet is not on an obstacle", !obstacleSet.has(cellKey(p)));
  }

  await api.wait(120);
  await api.screenshot("first");
  return check.verdict();
}
