// board/obstacles-absent — this mode's interior is open, and the head crosses all
// of it.
//
// WHAT THE SPECIFICATION FIXES. specs/mode.md: "`OBSTACLE_CELLS` is empty in this
// mode. The interior carries no obstacle cell, so the only solid cells on the
// board are the wall border and the snake's own body." specs/instrumentation.md
// has `reset` leave "no obstacle cell on the board" and the snapshot report
// `obstacles` as "empty, because this mode places no obstacle cell".
// specs/board.md leaves the interior at `28 x 16` cells, `col` in `[1, 28]` and
// `row` in `[1, 16]`.
//
// TWO READS, BECAUSE AN EMPTY LIST IS NOT AN OPEN BOARD. A build that reports no
// obstacle and still kills the head on a cell it treats as one is exactly as
// unplayable as a build that reports the cell, and the reported list alone cannot
// tell them apart. So the list is read, and then the head is walked across every
// interior cell there is.
//
// HOW THE WHOLE INTERIOR IS WALKED. A boustrophedon: along row 1 to the right
// wall, down one, back along row 2 to the left wall, down one, and so on to row
// 16. Within a row the direction never changes, so a row is one `setDirection`
// and one run of ticks, and the walk costs a few dozen crossings rather than one
// per cell. The pellet is off the board, so nothing is eaten and the chain never
// grows: it stays three cells, trailing directly behind the head, and never meets
// itself.
//
// The Maze mode lays a course across this interior, and states its own version of
// this point.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import {
  INTERIOR_MAX_COL,
  INTERIOR_MAX_ROW,
  INTERIOR_MIN_COL,
  INTERIOR_MIN_ROW,
} from "../../src/constants";
import {
  captureStill,
  createHarness,
  poseScene,
  type Cell,
  type CoilSnapshot,
  type Harness,
} from "../harness";

/** Cells across the interior, so `COLS - 1` ticks carry the head along a row. */
const COLS = INTERIOR_MAX_COL - INTERIOR_MIN_COL + 1;

/** Interior rows, each walked end to end. */
const ROWS = INTERIOR_MAX_ROW - INTERIOR_MIN_ROW + 1;

/** The chain posed at the start of the walk, head first, along the top row. */
const START: readonly Cell[] = [
  { col: 3, row: INTERIOR_MIN_ROW },
  { col: 2, row: INTERIOR_MIN_ROW },
  { col: 1, row: INTERIOR_MIN_ROW },
];

/**
 * Ticks the whole walk resolves.
 *
 * The first row is entered with the head already three cells along it, so it
 * takes `COLS - 3` ticks; each row after it costs one tick to drop into and
 * `COLS - 1` to cross.
 */
const WALK_TICKS = COLS - 3 + (ROWS - 1) * COLS;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reports no obstacle, and carries the head over every interior cell", async () => {
  const opened = poseScene(h, {
    obstacles: "course",
    snake: START,
    dir: "right",
    pellet: null,
  });
  assertLength(
    opened.obstacles,
    0,
    "obstacle cells on the board of a mode that lays none",
  );

  let walked: CoilSnapshot = opened;
  for (let row = INTERIOR_MIN_ROW; row <= INTERIOR_MAX_ROW; row += 1) {
    if (row > INTERIOR_MIN_ROW) {
      h.debug.setDirection("down");
      walked = await h.tick(1);
    }
    const rightwards = (row - INTERIOR_MIN_ROW) % 2 === 0;
    h.debug.setDirection(rightwards ? "right" : "left");
    walked = await h.tick(row === INTERIOR_MIN_ROW ? COLS - 3 : COLS - 1);
  }

  await h.advance(1);
  captureStill(h, "open");

  assertEqual(
    walked.screen,
    "playing",
    `the round after the head crossed all ${COLS * ROWS} interior cells`,
  );
  assertEqual(walked.ticks, WALK_TICKS, "ticks the walk resolved");
  assertLength(
    walked.obstacles,
    0,
    "obstacle cells on the board after the walk",
  );
});
