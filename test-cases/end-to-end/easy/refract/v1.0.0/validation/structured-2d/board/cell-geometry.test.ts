// Refract — board/cell-geometry: nodes sit on the cell centers the formula
// gives, on a small board and on the largest one, and the board does not drift
// as boards change size.
//
// specs/board.md "Where a cell sits" fixes the geometry: adjacent centers
// CELL_PITCH (96) apart on both axes, the grid centered on (BOARD_CX, BOARD_CY)
// (640, 392) whatever its dimensions, so the largest board's centers span
// x 352..928 and y 152..632. The check is over the RENDERED pixels, not the
// snapshot's derived x/y (instrumentation/snapshot-shape holds those): at every
// posed node's computed center a sampled cluster reads clearly apart from the
// bench — the item's 50 of 441 line — on a 3x3 and on a 7x6 board, and just
// outside the 7x6 board's four extent corners there is nothing but bench, so a
// build that anchored its grid to a corner, spaced it by its own pitch, or let
// it drift with the board's size fails on whichever board it misplaced.
//
// Two readings are generalized so the check serves what specs/board.md pins:
//
// - A node's "sampled cluster at its computed center" is the strongest sample
//   of its form ABOUT that center (the center cluster and rings inside
//   NODE_R), because an emitter is the OUTLINED silhouette — open at the very
//   center by design — and a check that sampled only the open middle would
//   fail every conformant emitter. The comparand is the board's own ground
//   (an empty cell's sample), since empty cells may legally carry quiet
//   texture the node must still stand apart from.
// - "Match the background" at the corners is read as the checklist's matching
//   line — within 25 of 441, the figure it states wherever a sample must show
//   the bare bench (node-radius, emitter-versus-lens, stage-fit) — sampled
//   diagonally NODE_R + 4 outside each corner center, off-board points no
//   node of a conformant board can reach.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertLessThanOrEqual } from "../assert";
import { GEO_3X3, GEO_7X6 } from "../fixtures";
import {
  captureStill,
  colorDistance,
  createHarness,
  loadBoard,
  resetTo,
  sampleBackground,
  sampleColor,
  type Harness,
} from "../harness";
import { cellCenter, NODE_R, type Board } from "../notation";
import { groundSample, strongestAboutCenter } from "./pixels";

/** The item's line for a node clearly apart from the bench: 50 of 441. */
const APART_MIN = 50;

/** The checklist's matching line for a sample of bare bench: 25 of 441. */
const MATCH_MAX = 25;

/** Diagonally outside a corner center, past every conformant node's reach. */
const CORNER_OUT = NODE_R + 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
  await resetTo(h, 1);
});

afterEach(() => {
  h?.dispose();
});

/** Every posed node's form reads clearly apart from the ground, at its center. */
function assertNodesOnCenters(board: Board): void {
  const ground = groundSample(h, board);
  for (const node of board.nodes) {
    const center = cellCenter(node.col, node.row, board.cols, board.rows);
    assertGreaterThan(
      strongestAboutCenter(h, center.x, center.y, ground),
      APART_MIN,
      `the ${node.kind} at (${node.col}, ${node.row}) drawn on its ` +
        `formula center (${center.x}, ${center.y})`,
    );
  }
}

it("draws every node of a posed 3x3 board on its formula center", async () => {
  const board = await loadBoard(h, GEO_3X3);
  assertNodesOnCenters(board);
});

it("draws every node of a posed 7x6 board on its formula center, with nothing just outside the extent", async () => {
  const board = await loadBoard(h, GEO_7X6);
  // The posed boards whose centers are sampled: the largest, whose corners the
  // drift check reads.
  captureStill(h, "board");

  assertNodesOnCenters(board);
  const background = sampleBackground(h);

  // The four corner centers of the largest extent (x 352..928, y 152..632,
  // specs/board.md), each stepped diagonally outward: a grid that drifted or
  // grew as the board did would put drawing here, and a conformant one cannot.
  const corners = [
    { x: 352 - CORNER_OUT, y: 152 - CORNER_OUT },
    { x: 928 + CORNER_OUT, y: 152 - CORNER_OUT },
    { x: 352 - CORNER_OUT, y: 632 + CORNER_OUT },
    { x: 928 + CORNER_OUT, y: 632 + CORNER_OUT },
  ];
  for (const corner of corners) {
    assertLessThanOrEqual(
      colorDistance(sampleColor(h, corner.x, corner.y), background),
      MATCH_MAX,
      `bare bench just outside the extent corner at (${corner.x}, ${corner.y})`,
    );
  }
});
