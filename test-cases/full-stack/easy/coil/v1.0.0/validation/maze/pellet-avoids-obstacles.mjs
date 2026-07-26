// Automated validation for the Maze sub-item `pellet-avoids-obstacles`.
//
// A respawned pellet never lands on an obstacle cell. The round is seeded and a run of
// eats is forced (place a pellet ahead, step to eat it); after each eat the AUTO-spawned
// pellet — the one the real spawn code chose — is read back and checked against the
// obstacle course. So the check observes the real spawn, not the precondition.
//
// The old hand-rolled eat loop is exactly what `actEatSequence` does, so it collapses
// onto `arrangeEatLane` + `actEatSequence`; the per-eat assertions move out of the loop
// into `assert`. The 14 eats ARE the clip — the old tail filmed a fresh 3-cell snake
// instead, which is not what the assertions drove.

import {
  actEatSequence,
  actPlayOn,
  arrangeEatLane,
  isInterior,
  cellKey,
  MAZE_OBSTACLES,
  beginRound,
} from "../_helpers.mjs";

const N = 14;

// After 14 eats the head is at col 17 with the snake 17 cells long, so 8 more ticks
// reach col 25 — still inside the interior, and the pellet the spawn code chose is the
// only thing it could meet. The asserted spawns are all captured by then.
const HOLD_TICKS = 8;

export default function item() {
  // The snapshot after each of the N eats; `snaps[i].pellet` is the AUTO-spawned one.
  let snaps;

  return {
    id: "maze.pellet-avoids-obstacles",

    async arrange(api) {
      await beginRound(api, 8675309);
      await arrangeEatLane(api); // the old setSnake(hLane(3, 8, 3), "right")
    },

    async act(api) {
      ({ snaps } = await actEatSequence(api, { count: N }));
      await actPlayOn(api, HOLD_TICKS);
    },

    async assert(api, check) {
      const obstacleSet = new Set(MAZE_OBSTACLES.map(cellKey));

      let anyOnObstacle = false;
      for (let i = 0; i < N; i += 1) {
        const p = snaps[i].pellet; // the AUTO-spawned pellet
        const onObstacle = p !== null && obstacleSet.has(cellKey(p));
        if (onObstacle) anyOnObstacle = true;
        check.expectOk(
          `respawn ${i + 1}: pellet ${JSON.stringify(p)} is interior and off every obstacle`,
          p !== null && isInterior(p) && !onObstacle,
        );
      }
      check.expectEq(
        `no respawned pellet across ${N} spawns landed on an obstacle`,
        anyOnObstacle,
        false,
      );
    },
  };
}
