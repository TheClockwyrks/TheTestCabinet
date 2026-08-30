// Refract — board/cell-geometry: nodes sit on the cell centers the formula
// gives.
//
// specs/board.md fixes the one part of Refract's appearance the game depends
// on: adjacent cell centers are CELL_PITCH (96) apart on both axes, and the
// grid is centered on (BOARD_CX, BOARD_CY) (640, 392) whatever its dimensions,
// through cellX/cellY. Every pointer position in the game is measured against
// those centers, so a board drawn anywhere else makes the hit radius wrong.
//
// The check poses two board sizes — a 3x3 and the largest, 7x6 — with a node in
// all but one cell, and reads the rendered pixels at every formula center: a
// node is there when some pixel within NODE_R (30) of that center stands more
// than 50 of 441 from the board's own ground (the review item's figure). The
// dense boards are what make a drift visible: a build that derived its grid
// from the wrong origin or pitch moves some center off its node, and the
// reading there is bare ground. The four corners just outside the 7x6 board's
// extent (the outermost centers widened by NODE_R, specs/board.md) must read as
// background — nothing of the board is drawn out there — which pins the grid to
// the stated center rather than merely to itself.
//
// EVERY NODE IS READ THE SAME WAY, by the loudest pixel of the form drawn about
// its center rather than by the center pixel alone. specs/board.md's only
// statement here is that a node's silhouette is drawn inside NODE_R of its cell
// center; which pixel inside that radius carries the form is the build's, and
// an emitter, the OUTLINED silhouette, is open at the very center by design
// while a lens may still wear an iris over the middle of its fill. A reading
// that demanded a painted center pixel would fail both for a rendering choice
// the specification leaves open, and role-by-role branching would decide
// emitter-versus-lens's requirement inside this item.
//
// PRESENCE IS NOT POSITION, so both are read. A form standing apart from the
// ground SOMEWHERE inside NODE_R of a formula center says only that something
// is drawn near that point: a node whose own silhouette reaches NODE_R answers
// it from as far as 2 * NODE_R away, more than half a CELL_PITCH, so a grid
// drawn half a pitch off center still leaves a crescent of the node that moved
// off each center inside the disc. What says the form is CENTERED on the point
// rather than merely visible from it is the body's centroid, and CENTROID_MAX
// below says how far it may sit and where that figure comes from.
//
// WHICH GROUND. The comparand is the board's OWN ground, an empty cell's sample
// on the same frame, which is why each posed board leaves one interior cell
// empty: specs/board.md lets a build draw whatever background it likes, so a
// node-region reading held against a stage-edge sample measures the build's
// backdrop as much as its node. The corner readings stay on the far-field
// background sample, because those points are genuinely off the board.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertLessThanOrEqual } from "../assert";
import {
  boardExtent,
  captureStill,
  colorDistance,
  createHarness,
  loadBoard,
  nodeCenter,
  resetTo,
  sampleBackground,
  sampleColor,
  type Harness,
} from "../harness";
import { NODE_R, parseBoard } from "../notation";
import { APART_MIN, bodyCentroid, bodyMask, groundSample } from "./masks";

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

/**
 * The corners "match the background": they do not differ from it by more than
 * the same 50 of 441 the item draws the line at — the complement of the
 * apart reading, as the empty-cells item states it for quiet cells.
 */
const MATCH_MAX = 50;

/**
 * A 3x3 with a node in every cell but one: one channel, its two emitters
 * cornered. The one gap is the cell the board's own ground is read from.
 */
const DENSE_3X3 = `
Ttt
t.t
ttT
`;

/** The largest board, 7x6, dense but for the one cell the ground is read from. */
const DENSE_7X6 = `
Ttttttt
ttttttt
ttt.ttt
ttttttt
ttttttt
ttttttT
`;

/** How far outside the extent the corner clusters sit, so the whole ±4 px
 * sample cluster stays out of the board's drawn box. */
const CORNER_OUT = 8;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/** Every formula center on `notation`'s board reads as a node. */
async function assertNodesOnCenters(notation: string): Promise<void> {
  await resetTo(h, 1);
  await loadBoard(h, notation);
  const board = parseBoard(notation);
  const ground = groundSample(h, board);

  for (const node of board.nodes) {
    const center = nodeCenter(node.col, node.row, board.cols, board.rows);
    const at =
      `the formula center of (${node.col}, ${node.row}) on the ` +
      `${board.cols}x${board.rows} board — (${center.x}, ${center.y}), ` +
      "specs/board.md cellX/cellY";
    const body = bodyMask(h, center.x, center.y, NODE_R, ground);
    assertGreaterThan(
      body.peak,
      APART_MIN,
      `a ${node.kind}'s loudest pixel within NODE_R (30) of ${at}`,
    );
    const centroid = bodyCentroid(body);
    assertLessThanOrEqual(
      centroid === null ? Infinity : Math.hypot(centroid.x, centroid.y),
      CENTROID_MAX,
      `how far a ${node.kind}'s own mass sits from ${at}`,
    );
  }
}

it("draws every node of a posed 3x3 board on its formula center", async () => {
  await assertNodesOnCenters(DENSE_3X3);
});

it("draws every node of a posed 7x6 board on its formula center, nothing outside its extent", async () => {
  await assertNodesOnCenters(DENSE_7X6);
  captureStill(h, "board");

  // The grid is centered on (BOARD_CX, BOARD_CY) whatever its dimensions, so
  // just outside the largest board's extent — the outermost centers widened by
  // NODE_R (specs/board.md) — there is only background.
  const background = sampleBackground(h);
  const extent = boardExtent(7, 6);
  const corners = [
    { x: extent.x0 - CORNER_OUT, y: extent.y0 - CORNER_OUT },
    { x: extent.x1 + CORNER_OUT, y: extent.y0 - CORNER_OUT },
    { x: extent.x0 - CORNER_OUT, y: extent.y1 + CORNER_OUT },
    { x: extent.x1 + CORNER_OUT, y: extent.y1 + CORNER_OUT },
  ];
  for (const corner of corners) {
    assertLessThanOrEqual(
      colorDistance(sampleColor(h, corner.x, corner.y), background),
      MATCH_MAX,
      `background just outside the 7x6 extent at (${corner.x}, ${corner.y})`,
    );
  }
});
