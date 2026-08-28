// Refract — campaign/select-grid: the grid shows every board, 1 through 24,
// six columns by four rows, in number order.
//
// specs/modes/campaign.md: "The grid presents all 24 boards in number order,
// six columns wide and four rows tall, one row per set, Set A at the top",
// and each board "shows its number". The numbers are read off the frame's
// text draws with their anchors; the arrangement is decided by clustering —
// each number's anchor sits with its own row and column, rows descending and
// columns running rightward in number order — while the tiles' art stays the
// build's own.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertLessThan } from "../assert";
import {
  captureStill,
  createHarness,
  startCampaign,
  textDraws,
  type Harness,
} from "../harness";
import { colCenters, minGap, numberDraws, rowCenters } from "./reading";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws 1 through 24 clustered into six columns and four rows, in number order", async () => {
  await startCampaign(h);
  const calls = await h.frameCalls();
  await captureStill(h, "grid");

  // Every number is drawn; the finder fails on the first one missing.
  const numbers = numberDraws(textDraws(calls));

  // Rows descend the frame and columns run rightward, in number order.
  const rows = rowCenters(numbers);
  const cols = colCenters(numbers);
  for (let row = 1; row < rows.length; row += 1) {
    assertGreaterThan(
      rows[row],
      rows[row - 1],
      `row ${row + 1} of the grid sits below row ${row}`,
    );
  }
  for (let col = 1; col < cols.length; col += 1) {
    assertGreaterThan(
      cols[col],
      cols[col - 1],
      `column ${col + 1} of the grid sits right of column ${col}`,
    );
  }

  // Each number clusters with its own row and column: board n (1-based) sits
  // in row floor((n-1)/6), column (n-1)%6, nearer its own band than any other.
  const rowGap = minGap(rows);
  const colGap = minGap(cols);
  numbers.forEach((draw, index) => {
    const row = Math.floor(index / 6);
    const col = index % 6;
    assertLessThan(
      Math.abs(draw.y - rows[row]),
      rowGap / 2,
      `board ${index + 1} clusters into row ${row + 1}`,
    );
    assertLessThan(
      Math.abs(draw.x - cols[col]),
      colGap / 2,
      `board ${index + 1} clusters into column ${col + 1}`,
    );
  });
});
