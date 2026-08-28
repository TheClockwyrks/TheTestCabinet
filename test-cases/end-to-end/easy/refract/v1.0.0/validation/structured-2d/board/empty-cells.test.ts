// Refract — board/empty-cells: an empty cell holds nothing.
//
// specs/board.md "Cells": an empty cell holds nothing and is drawn as nothing,
// or as quiet background texture of the build's choosing. The objective line
// between quiet texture and something a player would read as a node is the
// item's: every empty cell's sampled center stays within 50 of 441 RGB
// distance of the background sample — the same distance at which this
// checklist calls a node clearly apart from the bench — so a build may
// decorate its empty cells but never as loudly as it draws a node.
//
// The board is the full-size GEO_7X6, whose lens diagonal leaves 34 of its 42
// cells empty: every mixture of empty cell and neighboring node the largest
// grid produces is sampled on one frame.

import { afterEach, beforeEach, it } from "vitest";
import { assertLessThanOrEqual } from "../assert";
import { GEO_7X6 } from "../fixtures";
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
import { cellCenter } from "../notation";

/** The item's ceiling: quieter than a node, which sits beyond 50 of 441. */
const QUIET_MAX = 50;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
  await resetTo(h, 1);
});

afterEach(() => {
  h?.dispose();
});

it("keeps every empty cell of a posed 7x6 board quieter than a node", async () => {
  const board = await loadBoard(h, GEO_7X6);
  // The board whose empty cells are sampled.
  captureStill(h, "board");

  const background = sampleBackground(h);
  const occupied = new Set(
    board.nodes.map((node) => `${node.col},${node.row}`),
  );
  for (let row = 0; row < board.rows; row += 1) {
    for (let col = 0; col < board.cols; col += 1) {
      if (occupied.has(`${col},${row}`)) continue;
      const center = cellCenter(col, row, board.cols, board.rows);
      assertLessThanOrEqual(
        colorDistance(sampleColor(h, center.x, center.y), background),
        QUIET_MAX,
        `the empty cell (${col}, ${row})'s sampled center`,
      );
    }
  }
});
