// Cascade — deal/column-sizes: column n receives n cards, one to seven.
//
// specs/deal.md, The deal: "`DEAL_TABLEAU_CARDS` (`28`) cards go to the
// `TABLEAU_COLUMNS` (`7`) columns, left to right: column `0` receives one card,
// column `1` two, and so on to column `6`, which receives seven." The staircase
// is the deal: it is what leaves twenty-one cards face-down to be uncovered, and
// it is what makes twenty-four the number left for the stock. A build that deals
// a flat four to every column, or that runs the staircase the other way, has
// twenty-eight cards on the table and a different game under them.
//
// HOW IT IS REACHED. `openTable` resets, enters play and clears all thirteen
// piles, so every card counted here is one this deal put down; then `deal()`,
// the game's own deal path (specs/instrumentation.md), lays the board.
//
// The seven sizes are compared as ONE list rather than column by column, so the
// failure pair shows the whole staircase a build dealt beside the one the
// specification fixes — which is what says whether a build dealt the staircase
// backwards, flattened it, or missed a single column.
//
// The FACES those cards carry are deal/lowest-face-up and deal/rest-face-down,
// and WHICH cards they are is deal/full-deck.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual } from "../assert";
import { TABLEAU_COLUMNS } from "../constants";
import {
  captureStill,
  createHarness,
  openTable,
  type Harness,
} from "../harness";

/**
 * The staircase specs/deal.md fixes: column `i` receives `i + 1` cards, so the
 * seven columns hold 1, 2, 3, 4, 5, 6 and 7.
 */
const COLUMN_SIZES = Array.from(
  { length: TABLEAU_COLUMNS },
  (_unused, column) => column + 1,
);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("deals one card to the first column and seven to the last", async () => {
  await openTable(h);
  await h.debug.deal();
  await h.advance(1);
  await captureStill(h, "dealt");

  const { tableau } = await h.snapshot();
  assertDeepEqual(
    tableau.map((column) => column.length),
    COLUMN_SIZES,
    "cards in each of the seven columns, left to right (specs/deal.md)",
  );
});
