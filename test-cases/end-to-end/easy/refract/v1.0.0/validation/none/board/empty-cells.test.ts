// board/empty-cells — an empty cell holds nothing.
//
// specs/board.md: every cell is either empty or holds exactly one node, and an
// empty cell holds nothing and is drawn as nothing, or as quiet background
// texture of the build's choosing. "Quiet" gets the case's objective bound:
// every empty cell's sampled center stays within 50 of 441 of the bench — room
// for a grid dot or a faint texture, never for anything as loud as a node,
// which the same items require to stand MORE than 50 apart.

import { afterEach, beforeEach, it } from "vitest";
import { assertLessThanOrEqual } from "../assert";
import {
  captureStill,
  center,
  colorDistance,
  createHarness,
  loadBoard,
  sampleBench,
  sampleColor,
  type Harness,
} from "../harness";
import { DISTINCT_MIN } from "./sampling";

/**
 * A 5x4 board mixing nodes and gaps: two channels on the outer columns, a
 * crystal in the middle, and thirteen empty cells between and around them.
 */
const MIXED_BOARD = `
T...S
..2..
t...s
T...S
`;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("keeps every empty cell's center within 50 of the bench", async () => {
  const board = await loadBoard(h, MIXED_BOARD);
  await captureStill(h, "board");
  const bench = await sampleBench(h);

  const occupied = new Set(
    board.nodes.map((node) => `${node.col},${node.row}`),
  );
  for (let row = 0; row < board.rows; row += 1) {
    for (let col = 0; col < board.cols; col += 1) {
      if (occupied.has(`${col},${row}`)) continue;
      const at = center(board, { col, row });
      const color = await sampleColor(h, at.x, at.y);
      assertLessThanOrEqual(
        colorDistance(color, bench),
        DISTINCT_MIN,
        `the empty cell (${col}, ${row}) at its center (${at.x}, ${at.y})`,
      );
    }
  }
});
