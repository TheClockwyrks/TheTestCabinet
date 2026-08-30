// Refract — campaign/select-grid: the select frame draws every board's number,
// 1 through 24, in number order, six columns by four rows.
//
// The grid is read off one rendered frame's LOGICAL RUNS of text: each number's
// drawn centre, clustered along y into rows and along x into columns. The
// item's three clauses are then held directly — four rows of six, six columns
// of four, and the numbers running 1..24 across the rows from the top left —
// which is the layout specs/modes/campaign.md fixes ("The grid presents all 24
// boards in number order, six columns wide and four rows tall, one row per set,
// Set A at the top"), together with "Each board in the grid shows its number".
// Both are presence-and-arrangement requirements the specification states, so a
// validator may assert them; how the tiles look is not asserted anywhere here.
//
// WHY RUNS AND NOT `fillText` CALLS. A build's letter spacing is a font choice
// ("Palettes, fonts, layouts, and styling are the build's choices"), and canvas
// carries no portable letter-spacing property, so a glyph per `fillText` is the
// ordinary way to do it. A heading reading `1 OF 24 SOLVED` then puts a lone
// `"2"` and a lone `"4"` among the raw draws, which invents a fifth row of a
// grid that has four. The runs coalesce a heading back into one string and are
// a PARTITION, so a heading's digits can never read as a board's number.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  drawnTextRuns,
  startCampaign,
  type Harness,
} from "../harness";
import { CAMPAIGN_LENGTH } from "../notation";
import { GRID_COLS, GRID_ROWS, readSelectGrid } from "./reading";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws 1 through 24 in number order, six columns by four rows", async () => {
  await startCampaign(h);

  const calls = await h.frameCalls();
  await captureStill(h, "grid");

  const grid = readSelectGrid(drawnTextRuns(calls));
  assertLength(
    grid.rows,
    GRID_ROWS,
    "the numbers cluster into four rows, one per set (specs/modes/campaign.md)",
  );
  grid.rows.forEach((row, index) => {
    assertLength(
      row,
      GRID_COLS,
      `row ${index + 1} holds six boards (specs/modes/campaign.md)`,
    );
  });
  assertLength(
    grid.columns,
    GRID_COLS,
    "the numbers cluster into six columns (specs/modes/campaign.md)",
  );
  grid.columns.forEach((column, index) => {
    assertLength(
      column,
      GRID_ROWS,
      `column ${index + 1} holds four boards (specs/modes/campaign.md)`,
    );
  });

  assertDeepEqual(
    grid.rows.flat().map((point) => point.board),
    Array.from({ length: CAMPAIGN_LENGTH }, (_, index) => index + 1),
    "the numbers run 1 through 24 in number order across the rows, from the " +
      "top row down, so Set A's six are the top row (specs/modes/campaign.md)",
  );
});
