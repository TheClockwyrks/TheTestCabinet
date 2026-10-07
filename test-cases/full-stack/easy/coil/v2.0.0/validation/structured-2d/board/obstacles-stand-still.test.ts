// board/obstacles-stand-still — the course never changes while a round runs.
//
// specs/mode.md says of the course: "They are the same cells in every round, they
// never change while a round runs". WHICH cells the course is laid with is
// `board/obstacles-layout`; what this point decides is the second sentence, that
// the list a round opens with is the list it is still carrying after a stretch of
// live play. A build that lays the course from a generator, or that drops a cell
// the head passes beside, differs between the two reads.
//
// SO THE COMPARISON IS A SET COMPARISON, and it is made against the course the
// BUILD laid rather than against `MAZE_OBSTACLES`: a build with the wrong course
// fails `board/obstacles-layout` and must not fail this one twice.
//
// The round's own opening chain is walked down the starting row, with the pellet
// off the board so nothing is eaten and nothing grows, so the only thing that can
// change between the two reads is the thing this point is about.
//
// The Classic mode lays no obstacle cell, and this point belongs only to the mode
// that lays a course.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertGreaterThan } from "../assert";
import { type Cell } from "../constants";
import {
  captureReplay,
  createHarness,
  poseScene,
  type Harness,
} from "../harness";

/**
 * Ticks the round is run for between the two reads.
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

afterEach(() => {
  h?.dispose();
});

it("carries the same course after a stretch of live play", async () => {
  const laid = poseScene(h, { obstacles: "course", pellet: null });
  assertGreaterThan(
    laid.obstacles.length,
    0,
    "obstacle cells on the board when the round opened",
  );

  const played = await captureReplay(h, "unchanged", () => h.tick(TICKS));

  assertDeepEqual(
    keys(played.obstacles),
    keys(laid.obstacles),
    `the course after ${TICKS} ticks of play, as a set of cells`,
  );
});
