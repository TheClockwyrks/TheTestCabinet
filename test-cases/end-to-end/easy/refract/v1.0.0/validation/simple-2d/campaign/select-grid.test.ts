// Refract — campaign/select-grid: the select frame draws every board's number,
// 1 through 24, in number order, six columns by four rows.
//
// The grid is read off one rendered frame's text draws: each number's drawn
// centre, clustered along y into rows and along x into columns. The item's
// three clauses are then held directly — four rows of six, six columns of
// four, and the numbers running 1..24 across the rows from the top left —
// which is the layout specs/modes/campaign.md fixes ("The grid presents all
// 24 boards in number order, six columns wide and four rows tall, one row
// per set, Set A at the top").

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  resetTo,
  startCampaign,
  type Harness,
} from "../harness";
import { CAMPAIGN_LENGTH } from "../notation";
import { readSelectGrid } from "./helpers";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws 1 through 24 in number order, six columns by four rows", async () => {
  await resetTo(h);
  await startCampaign(h);

  h.calls.length = 0;
  await h.advance(1);
  captureStill(h, "grid");

  const grid = readSelectGrid(h);
  assertLength(
    grid.rows,
    4,
    "the numbers cluster into four rows, one per set (specs/modes/campaign.md)",
  );
  grid.rows.forEach((row, index) => {
    assertLength(
      row,
      6,
      `row ${index + 1} holds six boards (specs/modes/campaign.md)`,
    );
  });
  assertLength(
    grid.columns,
    6,
    "the numbers cluster into six columns (specs/modes/campaign.md)",
  );
  grid.columns.forEach((column, index) => {
    assertLength(
      column,
      4,
      `column ${index + 1} holds four boards (specs/modes/campaign.md)`,
    );
  });

  assertDeepEqual(
    grid.rows.flat().map((point) => point.board),
    Array.from({ length: CAMPAIGN_LENGTH }, (_, index) => index + 1),
    "the numbers run 1 through 24 in number order across the rows " +
      "(specs/modes/campaign.md)",
  );
});
