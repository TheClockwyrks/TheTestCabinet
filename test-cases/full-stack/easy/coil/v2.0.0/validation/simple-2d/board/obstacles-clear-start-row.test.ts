// board/obstacles-clear-start-row — the row the round opens on carries none of
// the course.
//
// WHAT THE SPECIFICATION FIXES. specs/board.md lays the opening chain along row
// `8` — head `(15, 8)`, body `(14, 8)`, tail `(13, 8)` — and specs/mode.md states
// of the course that "row `8`, the row the snake starts on, carries none of them,
// so the opening chain has a clear runway ahead of it".
//
// WHY THIS IS ITS OWN POINT rather than a corollary of `board/obstacles-layout`.
// The two decide different things about a build. The layout point decides whether
// the course is the cells the specification names; this one decides whether the
// round is PLAYABLE from the cell it opens on. A build that lays a course of its
// own devising fails the first and may still pass this one, and a build that lays
// a correct course except for one cell dropped onto row 8 fails both — which is
// the grade those two faults deserve.
//
// SO IT READS THE BUILD'S OWN COURSE rather than the specification's list: what
// is asked is where the cells this build laid are, not whether they are the right
// ones. The whole starting row is read, not the cells directly ahead of the head
// alone, because the snake turns and the row is a runway in both directions.
//
// The Classic mode lays no obstacle cell, and this point belongs only to the mode
// that lays a course.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertGreaterThan } from "../assert";
import { START_CELLS } from "../constants";
import {
  captureStill,
  createHarness,
  poseScene,
  type Cell,
  type Harness,
} from "../harness";

/** The row specs/board.md lays the opening chain along. */
const START_ROW = START_CELLS[0].row;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("lays no course cell on the row the opening chain sits on", async () => {
  const laid = poseScene(h, {
    obstacles: "course",
    pellet: null,
    travel: false,
  });
  await h.advance(1);
  captureStill(h, "runway");

  assertGreaterThan(
    laid.obstacles.length,
    0,
    "obstacle cells on the board of a mode that lays a course",
  );

  const onTheRow: Cell[] = laid.obstacles.filter(
    (cell) => cell.row === START_ROW,
  );
  assertDeepEqual(
    onTheRow,
    [],
    `the course cells sitting on row ${START_ROW}, the row the round opens on`,
  );
});
