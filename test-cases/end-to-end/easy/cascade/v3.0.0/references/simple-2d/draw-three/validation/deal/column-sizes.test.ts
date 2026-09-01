// deal/column-sizes — column `n` receives `n + 1` cards.
//
// THE RULE. specs/deal.md deals `DEAL_TABLEAU_CARDS` (`28`) cards to the seven
// columns, left to right: "column `0` receives one card, column `1` two, and so on
// to column `6`, which receives seven". So the seven column lengths are exactly
// `1, 2, 3, 4, 5, 6, 7`, and the triangle is what makes the layout Klondike's
// rather than a row of equal piles.
//
// EVERY COLUMN IS NAMED SEPARATELY. Each column is its own assertion, carrying its
// own index as context, so a build that deals `1..7` into the wrong order, or
// deals four cards everywhere, fails with the first column that disagreed named
// rather than with a bare "the tableau is wrong".
//
// THE TOTAL IS ASSERTED TOO, and last. `DEAL_TABLEAU_CARDS` is the figure
// specs/deal.md fixes for the whole tableau, and a build whose columns are each
// individually plausible but sum to something other than twenty-eight has still
// dealt a board the specification does not describe. It is read after the seven,
// so the seven name the fault first when they can.
//
// The counts alone are decided here. Which cards are face-up is
// `deal/lowest-face-up` and `deal/rest-face-down`, and how many columns there are
// at all is `deal/seven-columns`.

import { afterEach, beforeEach, it } from "vitest";
import { DEAL_TABLEAU_CARDS, TABLEAU_COLUMNS } from "../../src/constants";
import { assertEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  openTable,
  type Harness,
} from "../harness";

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("deals one card to the first column and seven to the last", async () => {
  openTable(harness);
  harness.debug.deal();

  await harness.advance(1);
  captureStill(harness, "dealt");

  const { tableau } = harness.snapshot();
  let dealt = 0;
  for (let column = 0; column < TABLEAU_COLUMNS; column += 1) {
    const cards = tableau[column] ?? [];
    dealt += cards.length;
    assertLength(
      cards,
      column + 1,
      `cards in column ${column} after a deal (specs/deal.md)`,
    );
  }

  assertEqual(
    dealt,
    DEAL_TABLEAU_CARDS,
    "cards a deal puts on the tableau in total (specs/deal.md)",
  );
});
