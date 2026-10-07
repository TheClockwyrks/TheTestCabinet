// board/cell-geometry — nodes sit on the cell centers the formula gives.
//
// specs/board.md fixes the one part of the look this case pins: adjacent cell
// centers are CELL_PITCH (96) apart on both axes, the grid is centered on
// (BOARD_CX, BOARD_CY) (640, 392) whatever its dimensions, and every position
// in the game — the pointer's hit radius above all — is measured against that.
// So the reading is pixels at the formula's own coordinates on a posed 3x3 and
// a posed 7x6 — the same centering on both, so the grid does not drift as the
// board changes size.
//
// THE READING IS PRESENCE AND NOTHING ELSE: within NODE_R of each formula
// center, some sampled pixel differs from the board's own ground, so the build
// drew a node there. It is read over the whole disc rather than at the center
// pixel alone because specs/board.md's only statement here is that a node's
// silhouette is drawn inside NODE_R of its cell center; which pixel inside that
// radius carries the form is the build's, and an emitter, the OUTLINED
// silhouette, is open at the very center by design. What the form looks like
// inside the disc — its shape, its hue, how much of the disc it fills, where
// its mass sits — specs/board.md leaves to the build, so none of it is decided
// here and all of it is the reviewer's presentation rating.
//
// THE BOARDS ARE POSED DENSE so a drift is visible: with a node in every cell
// but one, a grid derived from the wrong origin or the wrong pitch moves some
// center off its node, and the disc there reads bare ground.
//
// WHICH GROUND. The comparand is the board's OWN ground, an empty cell's sample
// on the same frame, which is why each posed board leaves one interior cell
// empty: specs/board.md lets a build draw whatever background it likes, so a
// node-region reading held against a stage-edge sample measures the build's
// backdrop as much as its node. Every reading this item takes is held against
// that ground; nothing is read off the board, because specs/board.md leaves
// what sits behind and around the board to the build.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan } from "../assert";
import {
  captureStill,
  center,
  createHarness,
  loadBoard,
  type Harness,
  type Rgb,
} from "../harness";
import { NODE_R, type Board } from "../notation";
import { diskPeak, groundSample, sampleDisk } from "./sampling";

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
    const disk = await sampleDisk(h, at.x, at.y, NODE_R);
    assertGreaterThan(
      diskPeak(disk, ground),
      0,
      `${what} ${node.kind} (${node.col}, ${node.row}): something drawn ` +
        `within NODE_R of its computed center (${at.x}, ${at.y})`,
    );
  }
}

it("draws every node of a 3x3 and a 7x6 on its formula center", async () => {
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
});
