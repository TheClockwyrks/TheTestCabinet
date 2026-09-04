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
// Three readings make the check serve what specs/board.md pins:
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
// - "Match the background" at the corners is read as the checklist's matching
//   line — within 25 of 441, the figure it states wherever a sample must show
//   the bare bench (emitter-versus-lens, stage-fit) — sampled diagonally
//   NODE_R + 4 outside each corner center, off-board points no node of a
//   conformant board can reach. Those points are genuinely off the board, so
//   they keep the far-field background sample.

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

/** The checklist's matching line for a sample of bare bench: 25 of 441. */
const MATCH_MAX = 25;

/**
 * Diagonally outside a corner center, past every conformant node's reach.
 *
 * specs/board.md item 4 lets a halo, a backing, or a highlight reach
 * `CELL_PITCH / 2` (`48`) from a cell center, so a probe nearer than that reads
 * drawing the spec permits. `sampleColor` averages a cluster of five points at
 * +/-4 on each axis, and the nearest of those to the corner center sits at
 * `hypot(CORNER_OUT - 4, CORNER_OUT)`, so the offset has to clear 48 with the
 * cluster included: at `NODE_R + 10` (`40`) the nearest sample is 53.8 out.
 */
const CORNER_OUT = NODE_R + 10;

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
