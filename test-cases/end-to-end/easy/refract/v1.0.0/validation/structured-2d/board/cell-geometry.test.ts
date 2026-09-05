// Refract — board/cell-geometry: nodes sit on the cell centers the formula
// gives, on a small board and on the largest one, and the board does not drift
// as boards change size.
//
// specs/board.md "Where a cell sits" fixes the geometry: adjacent centers
// CELL_PITCH (96) apart on both axes, the grid centered on (BOARD_CX, BOARD_CY)
// (640, 392) whatever its dimensions, so the largest board's centers span
// x 352..928 and y 152..632. The check is over the RENDERED pixels, not the
// snapshot's derived x/y (instrumentation/snapshot-shape holds those): within
// NODE_R of every posed node's computed center some sampled pixel differs from
// the board's own ground, on a 3x3 and on a 7x6 board, so a build that anchored
// its grid to a corner, spaced it by its own pitch, or let it drift with the
// board's size fails on whichever board it misplaced.
//
// THE READING IS PRESENCE AND NOTHING ELSE, over the whole region rather than at
// the center pixel alone. specs/board.md's only statement here is that a node's
// silhouette is drawn inside NODE_R of its cell center; which pixel inside that
// radius carries the form is the build's, and an emitter, the OUTLINED
// silhouette, is open at the very center by design. What the form looks like
// inside the region — its shape, its hue, how much of it it fills, where its
// mass sits — specs/board.md leaves to the build, so none of it is decided here
// and all of it is the reviewer's presentation rating.
//
// The comparand is the board's own ground (an empty cell's sample), since empty
// cells may legally carry quiet texture the node must still stand apart from,
// and a stage-edge sample would measure the build's backdrop as much as its
// node. Nothing is read off the board: specs/board.md leaves what sits behind
// and around the board to the build, so a sample just outside the extent
// measures a panel, a tray, or a vignette the specification permits rather than
// the geometry this item is about.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan } from "../assert";
import { GEO_3X3, GEO_7X6 } from "../fixtures";
import {
  captureStill,
  createHarness,
  loadBoard,
  resetTo,
  type Harness,
} from "../harness";
import { cellCenter, NODE_R, type Board } from "../notation";
import { groundSample, readRegion, regionPeak } from "./pixels";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
  await resetTo(h, 1);
});

afterEach(() => {
  h?.dispose();
});

/** Every posed node's cell center carries something the build drew. */
function assertNodesOnCenters(board: Board): void {
  const ground = groundSample(h, board);
  for (const node of board.nodes) {
    const center = cellCenter(node.col, node.row, board.cols, board.rows);
    assertGreaterThan(
      regionPeak(readRegion(h, center.x, center.y, NODE_R), ground),
      0,
      `the ${node.kind} at (${node.col}, ${node.row}): something drawn ` +
        `within NODE_R of its formula center (${center.x}, ${center.y})`,
    );
  }
}

it("draws every node of a posed 3x3 board on its formula center", async () => {
  const board = await loadBoard(h, GEO_3X3);
  assertNodesOnCenters(board);
});

it("draws every node of a posed 7x6 board on its formula center", async () => {
  const board = await loadBoard(h, GEO_7X6);
  // The posed boards whose centers are sampled: the largest of them.
  captureStill(h, "board");

  assertNodesOnCenters(board);
});
