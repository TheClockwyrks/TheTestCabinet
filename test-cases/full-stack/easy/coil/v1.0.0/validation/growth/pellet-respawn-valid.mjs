// Automated validation for the Growth & Pellets sub-item `pellet-respawn-valid`.
//
// After every eat exactly one new pellet spawns at an interior cell that is never on
// the snake (and, in Maze, never on an obstacle). The round is seeded and a run of
// eats is forced (place a pellet ahead, step to eat it); after each eat the
// AUTO-spawned pellet — the one the real spawn code chose, not the one we placed — is
// read back and checked for validity. So the check observes the real spawn, not the
// precondition.
//
// The old hand-rolled eat loop is exactly what `actEatSequence` does, so it collapses
// onto `arrangeEatLane` + `actEatSequence`; the per-eat assertions move out of the loop
// into `assert`, which walks the `snaps` the act half collected (it needs `s.snake`
// alongside `s.pellet`, which only `snaps` carries).

import {
  actEatSequence,
  actSettleShot,
  arrangeEatLane,
  isInterior,
  onSnake,
  cellKey,
  MAZE_OBSTACLES,
  beginRound,
} from "../_helpers.mjs";

const N = 8;

export default function item() {
  // Whether this build is the Maze variant, and the snapshot after each of the N eats.
  let maze;
  let snaps;

  return {
    id: "growth.pellet-respawn-valid",

    async arrange(api) {
      await beginRound(api, 24601);
      maze = (await api.snapshot()).mode === "maze";
      await arrangeEatLane(api); // the old setSnake(hLane(3, 8, 3), "right")
    },

    async act(api) {
      ({ snaps } = await actEatSequence(api, { count: N }));
      // settleMs 120 = the old trailing api.wait(120) before the capture.
      await actSettleShot(api, "pellet", { settleMs: 120 });
    },

    async assert(api, check) {
      const obstacleSet = new Set(MAZE_OBSTACLES.map(cellKey));

      let allValid = true;
      for (let i = 0; i < N; i += 1) {
        const s = snaps[i]; // s.pellet is the AUTO-spawned pellet
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
    },
  };
}
