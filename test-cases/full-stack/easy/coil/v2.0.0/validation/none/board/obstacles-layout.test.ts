// board/obstacles-layout — the course a round is laid with is the eighteen cells
// specs/mode.md fixes.
//
// WHAT THE SPECIFICATION FIXES. specs/mode.md names `OBSTACLE_CELLS` as four
// bars, tabulated cell by cell, and says of them: "They are the same cells in
// every round, they never change while a round runs, and they are exactly these
// four bars ... That is 18 cells." specs/instrumentation.md has `reset` put "the
// obstacle course back to `OBSTACLE_CELLS`", and the snapshot report `obstacles`
// as "the obstacle cells currently on the board, in any order".
//
// SO THE COMPARISON IS A SET COMPARISON. The order the build holds the course in
// is the build's, stated as such, so the two lists are compared as sets: no cell
// of the course missing, no cell on the board that the course does not name, and
// no cell laid twice.
//
// "They never change while a round runs" is a second sentence and a second point,
// `board/obstacles-stand-still`: a build that lays the right cells and then drops
// one the head passes beside fails that one and passes this.
//
// The Classic mode lays no obstacle cell, and this point belongs only to the mode
// that lays a course.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertLength } from "../assert";
import { type Cell, MAZE_OBSTACLES } from "../constants";
import {
  captureStill,
  createHarness,
  poseScene,
  type Harness,
} from "../harness";

/** A cell as one comparable string, so two courses compare as sets. */
function keys(cells: readonly Cell[]): string[] {
  return cells.map((cell) => `${cell.col},${cell.row}`).sort();
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("lays exactly the fixed course", async () => {
  const laid = await poseScene(h, { obstacles: "course", pellet: null });
  await h.advance(1);
  await captureStill(h, "layout");

  assertLength(
    laid.obstacles,
    MAZE_OBSTACLES.length,
    "obstacle cells on the board after a reset",
  );
  assertDeepEqual(
    keys(laid.obstacles),
    keys(MAZE_OBSTACLES),
    "the course the board carries, as a set of cells",
  );
});
