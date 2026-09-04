// board/obstacles-layout — the course a round is laid with is the eighteen cells
// specs/mode.md fixes, and it stands still while the round runs.
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
// AND THEN THE ROUND IS RUN. "They never change while a round runs" is a second
// sentence and a second read: the round's own opening chain is walked down the
// starting row, with the pellet off the board so nothing is eaten and nothing
// grows, and the list is read again. A build that lays the course from a
// generator, or that drops a cell the head passes beside, differs between the two
// reads. Nothing is posed onto the board for the walk, so the only thing that can
// go wrong between the two reads is the thing this point is about.
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

/**
 * Ticks the round is run for before the course is read a second time.
 *
 * The opening chain of specs/board.md heads right from `(15, 8)`, so twelve ticks
 * carry it to `(27, 8)` and leave it inside the border.
 */
const TICKS = 12;

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

it("lays exactly the fixed course, and holds it through the round", async () => {
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

  const played = await h.tick(TICKS);
  assertDeepEqual(
    keys(played.obstacles),
    keys(MAZE_OBSTACLES),
    `the course after ${TICKS} ticks of play, as a set of cells`,
  );
});
