// Automated validation for the Growth & Pellets sub-item `first-pellet-valid`.
//
// The first pellet of a round spawns after the snake is placed, at an interior cell
// that does not overlap the starting body (and, in Maze, not on an obstacle). A
// seeded round is started and the first pellet — chosen by the real spawn code — is
// read straight back from the snapshot and checked.
//
// Starting the seeded round and reading the snapshot are both instant, so they are
// `arrange`; `act` is the settle the capture needs, so the still shows a drawn board
// with the spawned pellet rather than a blank first frame.

import {
  actSettleShot,
  isInterior,
  onSnake,
  cellKey,
  MAZE_OBSTACLES,
  beginRound,
} from "../_helpers.mjs";

export default function item() {
  // The first pellet and the state it spawned into, read in `arrange`.
  let p;
  let s;
  let maze;

  return {
    id: "growth.first-pellet-valid",

    async arrange(api) {
      await beginRound(api, 777);
      s = await api.snapshot();
      p = s.pellet;
      maze = s.mode === "maze";
    },

    async act(api) {
      // settleMs 120 = the old trailing api.wait(120) before the capture.
      await actSettleShot(api, "first", { settleMs: 120 });
    },

    async assert(api, check) {
      const obstacleSet = new Set(MAZE_OBSTACLES.map(cellKey));

      check.expectNe("a first pellet was placed", p, null);
      check.expectOk("the first pellet is an interior cell", isInterior(p));
      check.expectOk(
        "the first pellet is not on the starting body",
        !onSnake(p, s.snake),
      );
      if (maze) {
        check.expectOk(
          "the first pellet is not on an obstacle",
          !obstacleSet.has(cellKey(p)),
        );
      }
    },
  };
}
