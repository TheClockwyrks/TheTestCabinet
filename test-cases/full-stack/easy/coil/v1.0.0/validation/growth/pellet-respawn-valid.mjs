// Automated validation for the Growth & Pellets sub-item `pellet-respawn-valid`.
//
// After every eat exactly one new pellet spawns at an interior cell that is never on
// the snake (and, in Maze, never on an obstacle). The round is seeded and a run of
// eats is forced (place a pellet ahead, step to eat it); after each eat the
// AUTO-spawned pellet — the one the real spawn code chose, not the one we placed — is
// read back and checked for validity. So the check observes the real spawn, not the
// precondition.

import {
  TICK_DT,
  hLane,
  isInterior,
  onSnake,
  cellKey,
  MAZE_OBSTACLES,
  beginRound,
} from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("growth.pellet-respawn-valid");

  await beginRound(api, 24601);
  const maze = (await api.snapshot()).mode === "maze";
  const obstacleSet = new Set(MAZE_OBSTACLES.map(cellKey));

  await api.call("setSnake", hLane(3, 8, 3), "right");

  let allValid = true;
  const N = 8;
  for (let i = 0; i < N; i += 1) {
    const head = (await api.snapshot()).snake[0];
    await api.call("setPellet", { col: head.col + 1, row: head.row }); // eat this one
    await api.step(TICK_DT);
    const s = await api.snapshot(); // s.pellet is the AUTO-spawned pellet
    const p = s.pellet;
    const valid =
      p !== null &&
      isInterior(p) &&
      !onSnake(p, s.snake) &&
      (!maze || !obstacleSet.has(cellKey(p)));
    if (!valid) allValid = false;
    check.expectOk(
      `respawn ${i + 1}: pellet ${JSON.stringify(p)} is interior, off the snake${maze ? " and off obstacles" : ""}`,
      valid,
    );
  }
  check.expectEq(`all ${N} respawned pellets were valid`, allValid, true);

  await api.wait(120);
  await api.screenshot("pellet");
  return check.verdict();
}
