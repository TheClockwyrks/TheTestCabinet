// Automated validation for the Maze sub-item `pellet-avoids-obstacles`.
//
// A respawned pellet never lands on an obstacle cell. The round is seeded and a run of
// eats is forced (place a pellet ahead, step to eat it); after each eat the AUTO-spawned
// pellet — the one the real spawn code chose — is read back and checked against the
// obstacle course. So the check observes the real spawn, not the precondition.

import {
  TICK_DT,
  hLane,
  isInterior,
  cellKey,
  MAZE_OBSTACLES,
  liveClip,
  beginRound,
} from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("maze.pellet-avoids-obstacles");

  await beginRound(api, 8675309);
  const obstacleSet = new Set(MAZE_OBSTACLES.map(cellKey));

  await api.call("setSnake", hLane(3, 8, 3), "right");

  let anyOnObstacle = false;
  const N = 14;
  for (let i = 0; i < N; i += 1) {
    const head = (await api.snapshot()).snake[0];
    await api.call("setPellet", { col: head.col + 1, row: head.row }); // eat this one
    await api.step(TICK_DT);
    const p = (await api.snapshot()).pellet; // the AUTO-spawned pellet
    const onObstacle = p !== null && obstacleSet.has(cellKey(p));
    if (onObstacle) anyOnObstacle = true;
    check.expectOk(
      `respawn ${i + 1}: pellet ${JSON.stringify(p)} is interior and off every obstacle`,
      p !== null && isInterior(p) && !onObstacle,
    );
  }
  check.expectEq(`no respawned pellet across ${N} spawns landed on an obstacle`, anyOnObstacle, false);

  await liveClip(api, { snake: hLane(3, 8, 3), pellet: { col: 6, row: 8 } });
  return check.verdict();
}
