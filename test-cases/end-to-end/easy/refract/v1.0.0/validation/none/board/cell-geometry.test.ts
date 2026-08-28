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
// TWO READINGS, BY NODE ROLE. A lens is the FILLED silhouette of its channel
// (specs/board.md), so its formula center is painted: the sampled cluster
// there stands more than the item's 50 of 441 apart from the bench. An
// emitter is the OUTLINED silhouette, open at its center — the boards must
// carry two per channel present to be boards at all — so an emitter is read
// as drawn AT its computed center by the farthest pixel of a sweep within
// NODE_R of it standing apart from the bench by the same 50: its stroke is
// inside the box the formula puts there, or nowhere.

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
import { DISTINCT_MIN, MATCH_MAX, sweepMaxDistance } from "./sampling";

/** A fully occupied 3x3: two emitters per channel, lenses between. */
const FULL_3X3 = `
TSD
tsd
TSD
`;

/** A fully occupied 7x6: two emitters per channel, lenses everywhere else. */
const FULL_7X6 = `
TstStdD
tsdsdst
sdtstds
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
  bench: Rgb,
  what: string,
): Promise<void> {
  for (const node of board.nodes) {
    const at = center(board, node);
    if (node.kind === "lens") {
      const color = await sampleColor(h, at.x, at.y);
      assertGreaterThan(
        colorDistance(color, bench),
        DISTINCT_MIN,
        `${what} lens (${node.col}, ${node.row}) filled at its computed center (${at.x}, ${at.y})`,
      );
    } else {
      assertGreaterThan(
        await sweepMaxDistance(h, at, bench),
        DISTINCT_MIN,
        `${what} emitter (${node.col}, ${node.row}) drawn within NODE_R of its computed center (${at.x}, ${at.y})`,
      );
    }
  }
}

it("draws every node of a 3x3 and a 7x6 on its formula center, and nothing outside the extent", async () => {
  // The 3x3 first: nine centers, each computed from the formula for a board
  // of THESE dimensions, so a build that anchored the grid anywhere but the
  // shared center misses them.
  const small = await loadBoard(h, FULL_3X3);
  let bench = await sampleBench(h);
  await assertNodesOnCenters(small, bench, "3x3");

  // Then the largest board on the SAME centering: forty-two centers under the
  // same formula, so the grid did not drift as the board changed size.
  const large = await loadBoard(h, FULL_7X6);
  await captureStill(h, "board");
  bench = await sampleBench(h);
  await assertNodesOnCenters(large, bench, "7x6");

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
