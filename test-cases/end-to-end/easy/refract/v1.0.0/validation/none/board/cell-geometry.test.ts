// board/cell-geometry — nodes sit on the cell centers the formula gives.
//
// specs/board.md fixes the one part of the look this case pins: adjacent cell
// centers are CELL_PITCH (96) apart on both axes, the grid is centered on
// (BOARD_CX, BOARD_CY) (640, 392) whatever its dimensions, and every position
// in the game — the pointer's hit radius above all — is measured against that.
// So the reading is pixels at the formula's own coordinates on a posed 3x3
// and a posed 7x6, and bare bench at the four corners just outside the 7x6
// board's extent (cell centers spanning x 352..928, y 152..632, widened by
// NODE_R) — so the grid neither drifts nor spills as boards change size.
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
// backdrop as much as its node. The corner readings stay on the bench sample,
// because those points are genuinely off the board.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertLessThanOrEqual } from "../assert";
import {
  captureStill,
  center,
  colorDistance,
  createHarness,
  loadBoard,
  sampleBench,
  sampleColor,
  type Harness,
  type Rgb,
} from "../harness";
import { NODE_R, type Board } from "../notation";
import {
  APART_MIN,
  bodyCentroid,
  bodyMask,
  groundSample,
  MATCH_MAX,
} from "./sampling";

/**
 * A 3x3 occupied but for one cell: two emitters per channel, lenses between.
 * The one gap is the cell the board's own ground is read from.
 */
const FULL_3X3 = `
TSD
t.d
TSD
`;

/** A 7x6 occupied but for the one cell the board's ground is read from. */
const FULL_7X6 = `
TstStdD
tsdsdst
sdt.tds
dtststd
tsdtdst
DtsSdtT
`;

/**
 * Points just outside the four corners of the largest board's extent — the
 * center span x 352..928, y 152..632 widened by NODE_R (specs/board.md), then
 * 12 px further out diagonally so the sampled cluster sits wholly clear of a
 * conformant board's own anti-aliased edge. A grid that drifted off center or
 * outgrew the formula's pitch puts drawn form here; a conformant one leaves
 * the bench bare.
 */
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

const OUTSIDE_MARGIN = 12;
const OUTSIDE_CORNERS = [
  { x: 352 - NODE_R - OUTSIDE_MARGIN, y: 152 - NODE_R - OUTSIDE_MARGIN },
  { x: 928 + NODE_R + OUTSIDE_MARGIN, y: 152 - NODE_R - OUTSIDE_MARGIN },
  { x: 352 - NODE_R - OUTSIDE_MARGIN, y: 632 + NODE_R + OUTSIDE_MARGIN },
  { x: 928 + NODE_R + OUTSIDE_MARGIN, y: 632 + NODE_R + OUTSIDE_MARGIN },
] as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** Every node of `board` is drawn at its formula center. */
async function assertNodesOnCenters(
  board: Board,
  ground: Rgb,
  what: string,
): Promise<void> {
  for (const node of board.nodes) {
    const at = center(board, node);
    const body = await bodyMask(h, at.x, at.y, NODE_R, ground);
    const where = `${what} ${node.kind} (${node.col}, ${node.row})`;
    assertGreaterThan(
      body.peak,
      APART_MIN,
      `${where}: its loudest pixel within NODE_R of its computed center (${at.x}, ${at.y})`,
    );
    const centroid = bodyCentroid(body);
    assertLessThanOrEqual(
      centroid === null ? Infinity : Math.hypot(centroid.x, centroid.y),
      CENTROID_MAX,
      `${where}: how far the form drawn about its computed center (${at.x}, ${at.y}) has its own mass sitting from that point`,
    );
  }
}

it("draws every node of a 3x3 and a 7x6 on its formula center, and nothing outside the extent", async () => {
  // The 3x3 first: eight centers, each computed from the formula for a board
  // of THESE dimensions, so a build that anchored the grid anywhere but the
  // shared center misses them.
  const small = await loadBoard(h, FULL_3X3);
  await assertNodesOnCenters(small, await groundSample(h, small), "3x3");

  // Then the largest board on the SAME centering: forty-one centers under the
  // same formula, so the grid did not drift as the board changed size.
  const large = await loadBoard(h, FULL_7X6);
  await captureStill(h, "board");
  await assertNodesOnCenters(large, await groundSample(h, large), "7x6");
  const bench = await sampleBench(h);

  // And just outside the four corners of the widened extent, bare bench: a
  // grid drawn oversized, off-pitch, or off-center puts form out here.
  for (const corner of OUTSIDE_CORNERS) {
    const color = await sampleColor(h, corner.x, corner.y);
    assertLessThanOrEqual(
      colorDistance(color, bench),
      MATCH_MAX,
      `bare bench just outside the extent at (${corner.x}, ${corner.y})`,
    );
  }
});
