// Refract — board/empty-cells: an empty cell holds nothing.
//
// specs/board.md: an empty cell holds nothing and is drawn as nothing, or as
// quiet background texture of the build's choosing. The check poses GEO_7X6 —
// the largest board, its lens diagonal leaving thirty-four empty cells across
// every region of the grid — and samples every empty cell's center: each must
// stay within 50 of 441 RGB distance of the background sample (the review
// item's figure), so an empty cell may carry quiet texture but never anything
// as loud as a node.

import { afterEach, beforeEach, it } from "vitest";
import { assertLessThanOrEqual } from "../assert";
import { GEO_7X6 } from "../fixtures";
import {
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
import { parseBoard } from "../notation";

/** The review item's tolerance: quiet texture at most, never a node. */
const QUIET_MAX = 50;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("keeps every empty cell's center within the background's quiet", async () => {
  await resetTo(h, 1);
  await loadBoard(h, GEO_7X6);
  captureStill(h, "board");

  const board = parseBoard(GEO_7X6);
  const occupied = new Set(
    board.nodes.map((node) => `${node.col},${node.row}`),
  );
  const background = sampleBackground(h);

  for (let row = 0; row < board.rows; row += 1) {
    for (let col = 0; col < board.cols; col += 1) {
      if (occupied.has(`${col},${row}`)) continue;
      const center = nodeCenter(col, row, board.cols, board.rows);
      assertLessThanOrEqual(
        colorDistance(sampleColor(h, center.x, center.y), background),
        QUIET_MAX,
        `the empty cell (${col}, ${row}) — specs/board.md: an empty cell is ` +
          "drawn as nothing, or as quiet background texture",
      );
    }
  }
});
