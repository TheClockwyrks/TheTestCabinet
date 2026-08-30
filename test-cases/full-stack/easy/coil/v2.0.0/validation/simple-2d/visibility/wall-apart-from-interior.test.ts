// visibility/wall-apart-from-interior — the border a player must not touch is
// visible against the field it encloses.
//
// WHAT THE SPECIFICATION FIXES. `specs/overview.md` requires that "the interior
// play area and the one-cell wall border around it are told apart at a glance,
// and the border reads as solid", and `specs/board.md` makes that border one cell
// thick on all four sides, drawn for the whole round. The palette is the build's,
// so what is read is separation alone, against the review item's figure for
// clearly apart: more than 50 of the 441 the RGB cube spans.
//
// THE WORLD THIS POSES. Nothing but the chain, which cannot be taken off the
// board: the pellet is cleared, the obstacle course is cleared, and the chain is
// laid across the middle of the interior, far from the wall cell sampled and far
// from the empty cell it is sampled against. Travel is switched off, so nothing
// moves between the pose and the sample.
//
// WHERE IT SAMPLES. `WALL_CELL` is column `0` at mid height — border at every
// row (`specs/board.md`), and as far from a corner as the board goes, so a build
// that rounds or highlights its corners is read on the run of the border rather
// than on a joint.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan } from "../assert";
import {
  captureStill,
  chainFrom,
  colorDistance,
  createHarness,
  HOME_HEAD,
  poseScene,
  sampleCells,
  WALL_CELL,
  type Cell,
  type Harness,
} from "../harness";

/** The review item's distance: clearly apart on the 0–441 RGB scale. */
const DISTINCT_MIN = 50;

/** The interior cell the posed world leaves empty, well inside the border. */
const BOARD_CELL: Cell = { col: 20, row: 12 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws a wall cell apart from an empty interior cell", async () => {
  poseScene(h, {
    snake: chainFrom(HOME_HEAD, "right", 3),
    dir: "right",
    pellet: null,
    travel: false,
  });
  await h.advance(1);
  captureStill(h, "scene");

  const [wall, board] = sampleCells(h, [WALL_CELL, BOARD_CELL]);

  assertGreaterThan(
    colorDistance(wall, board),
    DISTINCT_MIN,
    "the RGB distance between a wall cell's centre and an empty interior cell's",
  );
});
