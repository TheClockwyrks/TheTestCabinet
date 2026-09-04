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
// board's own ground — the item's 50 of 441 line — on a 3x3 and on a 7x6 board,
// so a build that anchored its grid to a corner, spaced it by its own pitch, or
// let it drift with the board's size fails on whichever board it misplaced.
//
// Two readings make the check serve what specs/board.md pins:
//
// - EVERY NODE IS READ THE SAME WAY, by the loudest pixel of the form drawn
//   within NODE_R of its computed center rather than by the center pixel
//   alone. specs/board.md's only statement here is that a node's silhouette is
//   drawn inside NODE_R of its cell center; which pixel inside that radius
//   carries the form is the build's, and an emitter, the OUTLINED silhouette,
//   is open at the very center by design while a lens may still wear an iris
//   over the middle of its fill. The comparand is the board's own ground (an
//   empty cell's sample), since empty cells may legally carry quiet texture the
//   node must still stand apart from, and a stage-edge sample would measure the
//   build's backdrop as much as its node.
// - PRESENCE IS NOT POSITION, so both are read. A form standing apart from the
//   ground SOMEWHERE inside NODE_R of a formula center says only that something
//   is drawn near that point: a node whose own silhouette reaches NODE_R answers
//   it from as far as 2 * NODE_R away, more than half a CELL_PITCH, so a grid
//   drawn half a pitch off center still leaves a crescent of the node that moved
//   off each center inside the disc. What says the form is CENTERED on the point
//   rather than merely visible from it is the body's centroid, and CENTROID_MAX
//   below says how far it may sit and where that figure comes from.
//
// Nothing is read off the board. specs/board.md leaves what sits behind and
// around the board to the build, so a sample just outside the extent measures
// a panel, a tray, or a vignette the specification permits rather than the
// geometry this item is about.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertLessThanOrEqual } from "../assert";
import { GEO_3X3, GEO_7X6 } from "../fixtures";
import {
  captureStill,
  createHarness,
  loadBoard,
  resetTo,
  type Harness,
} from "../harness";
import { cellCenter, NODE_R, type Board } from "../notation";
import { APART_MIN, bodyCentroid, bodyMask, groundSample } from "./pixels";

/**
 * How far the body's centroid may sit from the formula center.
 *
 * specs/board.md draws the disc of NODE_R (30) about a cell center as the box a
 * node's silhouette is drawn inside, and pins the three forms — a triangle, a
 * square, and a diamond. A square and a diamond are centrally symmetric, so one
 * filling its box puts its centroid on the center exactly. A triangle does not:
 * the most lopsided triangle that still fills the box is the isoceles one with
 * its apex on the rim and its base a chord across the far side, and its centroid
 * sits NODE_R / 3 (10) out. That is the largest offset the pinned forms
 * themselves produce, and 2 px is added on top for the binarized edge and the
 * lattice the disc is sampled on.
 *
 * Nothing here is read off this case's builds, and the line is nowhere near
 * what it must catch: a grid drawn half a CELL_PITCH off center leaves each
 * formula center reading a crescent of the node that moved off it, whose
 * centroid sits about 24 out.
 */
const CENTROID_MAX = NODE_R / 3 + 2;

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
    const body = bodyMask(h, center.x, center.y, NODE_R, ground);
    assertGreaterThan(
      body.peak,
      APART_MIN,
      `the ${node.kind} at (${node.col}, ${node.row}): its loudest pixel ` +
        `within NODE_R of its formula center (${center.x}, ${center.y})`,
    );
    const centroid = bodyCentroid(body);
    assertLessThanOrEqual(
      centroid === null ? Infinity : Math.hypot(centroid.x, centroid.y),
      CENTROID_MAX,
      `the ${node.kind} at (${node.col}, ${node.row}): how far the form ` +
        `drawn about its formula center (${center.x}, ${center.y}) has its ` +
        `own mass sitting from that point`,
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
