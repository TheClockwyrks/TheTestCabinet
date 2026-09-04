// visibility/pellet-apart-from-board — the pellet is not the colour of the board
// under it.
//
// WHAT THE SPECIFICATION FIXES. `specs/overview.md` requires that "the pellet
// stands apart from the field, the border, and the snake", over a board whose
// palette is the build's own. So what is read is separation alone, against the
// case's figure for clearly apart: more than `DISTINCT_MIN` (50) of the 441 the
// RGB cube spans. This suite decides the field half of that requirement.
//
// THE WORLD THIS POSES. The pellet on a cell of the check's choosing, the snake
// laid far from it (it cannot be taken off the board, `specs/instrumentation.md`),
// the obstacle course cleared, and travel switched off — so nothing walks into
// the pellet's cell between the pose and the sample, and no eat replaces it
// somewhere the check did not choose.
//
// WHERE IT SAMPLES. The pellet cell's centre, against the centre of an interior
// cell the posed world leaves empty. `specs/board.md` draws the pellet one cell
// in size, so its cell's centre is inside it.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan } from "../assert";
import type { Cell } from "../constants";
import { DISTINCT_MIN } from "../constants";
import {
  captureStill,
  chainFrom,
  colorDistance,
  createHarness,
  HOME_HEAD,
  poseScene,
  sampleCells,
  type Harness,
} from "../harness";

/** Where the pellet is placed: an interior cell clear of the posed chain. */
const PELLET_CELL: Cell = { col: 20, row: 5 };

/** The interior cell the posed world leaves empty, far from both and from the wall. */
const BOARD_CELL: Cell = { col: 20, row: 12 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the pellet apart from an empty interior cell", async () => {
  await poseScene(h, {
    snake: chainFrom(HOME_HEAD, "right", 3),
    dir: "right",
    pellet: PELLET_CELL,
    travel: false,
  });
  await h.advance(1);
  await captureStill(h, "scene");

  const [pellet, board] = await sampleCells(h, [PELLET_CELL, BOARD_CELL]);

  assertGreaterThan(
    colorDistance(pellet, board),
    DISTINCT_MIN,
    "the RGB distance between the pellet cell's centre and an empty interior cell's",
  );
});
