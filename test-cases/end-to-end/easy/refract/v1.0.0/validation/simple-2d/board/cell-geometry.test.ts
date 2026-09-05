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
// node is there when some pixel within NODE_R (30) of that center differs from
// the board's own ground. The dense boards are what make a drift visible: a
// build that derived its grid from the wrong origin or pitch moves some center
// off its node, and the reading there is bare ground. Reading the SAME centering
// on two board sizes is what pins the grid to the stated center rather than
// merely to itself.
//
// THE READING IS PRESENCE AND NOTHING ELSE, over the whole disc rather than at
// the center pixel alone. specs/board.md's only statement here is that a node's
// silhouette is drawn inside NODE_R of its cell center; which pixel inside that
// radius carries the form is the build's, and an emitter, the OUTLINED
// silhouette, is open at the very center by design. What the form looks like
// inside the disc — its shape, its hue, how much of the disc it fills, where its
// mass sits — specs/board.md leaves to the build, so none of it is decided here
// and all of it is the reviewer's presentation rating.
//
// WHICH GROUND. The comparand is the board's OWN ground, an empty cell's sample
// on the same frame, which is why each posed board leaves one interior cell
// empty: specs/board.md lets a build draw whatever background it likes, so a
// node-region reading held against a stage-edge sample measures the build's
// backdrop as much as its node. Every reading in this item is held against that
// ground, and none is taken off the board: specs/board.md leaves what sits
// behind and around the board to the build, so a panel, a tray, or a vignette
// drawn there is a design choice this item has nothing to say about.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  loadBoard,
  nodeCenter,
  resetTo,
  type Harness,
} from "../harness";
import { NODE_R, parseBoard } from "../notation";
import { diskPeak, diskPixels, groundSample } from "./masks";

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
    assertGreaterThan(
      diskPeak(diskPixels(h, center.x, center.y, NODE_R), ground),
      0,
      `a ${node.kind} drawn within NODE_R (30) of ${at}`,
    );
  }
}

it("draws every node of a posed 3x3 board on its formula center", async () => {
  await assertNodesOnCenters(DENSE_3X3);
});

it("draws every node of a posed 7x6 board on its formula center", async () => {
  await assertNodesOnCenters(DENSE_7X6);
  captureStill(h, "board");
});
