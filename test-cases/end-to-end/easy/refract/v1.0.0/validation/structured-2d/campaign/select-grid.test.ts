// Refract — campaign/select-grid: the select frame draws the numbers 1
// through 24 in number order, clustering into six columns and four rows.
//
// The grid is read from the frame's own text draws: exactly one draw per
// number, their centers clustered into six column bands and four row bands —
// no assumption about where the grid sits or how wide its gutters are, only
// that the bands separate — with each band holding its share and every number
// landing in the column and row its number-order position gives it, one row
// per set (specs/modes/campaign.md: six columns wide, four rows tall, Set A at
// the top).

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startCampaign,
  type Harness,
} from "../harness";
import {
  GRID_COLS,
  GRID_ROWS,
  nearestIndex,
  readSelectGrid,
  spanCenterX,
} from "./support";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws 1 through 24 in number order, six columns by four rows", async () => {
  await startCampaign(h);
  h.calls.length = 0;
  await h.advance(1);
  captureStill(h, "grid");

  const grid = readSelectGrid(h);

  const perColumn = new Array<number>(GRID_COLS).fill(0);
  const perRow = new Array<number>(GRID_ROWS).fill(0);
  grid.spans.forEach((span, index) => {
    const number = index + 1;
    const column = nearestIndex(grid.columnsX, spanCenterX(span));
    const row = nearestIndex(grid.rowsY, span.y);
    perColumn[column] += 1;
    perRow[row] += 1;
    // Number order: n sits in column (n-1) mod 6 of row (n-1) div 6.
    assertEqual(
      column,
      (number - 1) % GRID_COLS,
      `board ${number}'s column, counting from 0`,
    );
    assertEqual(
      row,
      Math.floor((number - 1) / GRID_COLS),
      `board ${number}'s row, counting from 0`,
    );
  });
  perColumn.forEach((count, column) => {
    assertEqual(count, GRID_ROWS, `numbers in column ${column + 1} of 6`);
  });
  perRow.forEach((count, row) => {
    assertEqual(count, GRID_COLS, `numbers in row ${row + 1} of 4`);
  });
});
