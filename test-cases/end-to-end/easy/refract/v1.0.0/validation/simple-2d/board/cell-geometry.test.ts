// Refract — board/cell-geometry: nodes sit on the cell centers the formula
// gives.
//
// specs/board.md fixes the one part of Refract's appearance the game depends
// on: adjacent cell centers are CELL_PITCH (96) apart on both axes, and the
// grid is centered on (BOARD_CX, BOARD_CY) (640, 392) whatever its dimensions,
// through cellX/cellY. Every pointer position in the game is measured against
// those centers, so a board drawn anywhere else makes the hit radius wrong.
//
// The check poses two board sizes — a 3x3 and the largest, 7x6 — with a node
// in EVERY cell, and samples the rendered pixels at every formula center: a
// node is there when its sample differs from the background sample by more
// than 50 of 441 RGB distance (the review item's figure). The dense boards
// are what make a drift visible: a build that derived its grid from the wrong
// origin or pitch moves some center off its node, and the sample there reads
// background. The four corners just outside the 7x6 board's extent (the
// outermost centers widened by NODE_R, specs/board.md) must read as
// background — nothing of the board is drawn out there — which pins the grid
// to the stated center rather than merely to itself.
//
// WHAT IS SAMPLED AT AN EMITTER. A board carries its channel's two emitters
// (specs/board.md: every channel present has exactly two), and an emitter is
// the OUTLINED silhouette — its center deliberately shows the background
// through, as the emitter-versus-lens item states. So the center cluster is
// the reading for the filled nodes (every lens), and an emitter is read as
// drawn-on-its-center when some pixel within NODE_R (30) of the formula
// center — the radius its whole form fits inside — clears the same 50 of 441
// line: the outline, on the center it belongs to.

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
import { diskPixels } from "./masks";

/** The review item's distance: a node clearly apart from the background. */
const APART_MIN = 50;

/**
 * The corners "match the background": they do not differ from it by more than
 * the same 50 of 441 the item draws the line at — the complement of the
 * apart reading, as the empty-cells item states it for quiet cells.
 */
const MATCH_MAX = 50;

/** A 3x3 with a node in every cell: one channel, its two emitters cornered. */
const DENSE_3X3 = `
Ttt
ttt
ttT
`;

/** The largest board, 7x6, with a node in every cell. */
const DENSE_7X6 = `
Ttttttt
ttttttt
ttttttt
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
  const background = sampleBackground(h);

  for (const node of board.nodes) {
    const center = nodeCenter(node.col, node.row, board.cols, board.rows);
    const at =
      `the formula center of (${node.col}, ${node.row}) on the ` +
      `${board.cols}x${board.rows} board — (${center.x}, ${center.y}), ` +
      "specs/board.md cellX/cellY";
    if (node.kind === "emitter") {
      // An emitter's center is open by design; its outline within NODE_R of
      // the formula center is what says the node is drawn there.
      const loudest = Math.max(
        ...diskPixels(h, center.x, center.y, NODE_R).map((pixel) =>
          colorDistance(pixel.color, background),
        ),
      );
      assertGreaterThan(
        loudest,
        APART_MIN,
        `an emitter's outline within NODE_R (30) of ${at}`,
      );
    } else {
      assertGreaterThan(
        colorDistance(sampleColor(h, center.x, center.y), background),
        APART_MIN,
        `a lens drawn at ${at}`,
      );
    }
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
