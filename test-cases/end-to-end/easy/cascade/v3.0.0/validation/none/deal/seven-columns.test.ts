// Cascade — deal/seven-columns: a deal lays the tableau out across seven columns.
//
// specs/deal.md, The deal: "`DEAL_TABLEAU_CARDS` (`28`) cards go to the
// `TABLEAU_COLUMNS` (`7`) columns, left to right: column `0` receives one card,
// column `1` two, and so on to column `6`, which receives seven." Seven is the
// shape of the whole game — specs/table.md anchors seven columns, specs/tableau.md
// writes every stacking rule over them — so a build that deals into six of them,
// or that carries some other number of columns entirely, is playing a different
// game on a table that does not fit it.
//
// TWO READINGS, ONE REQUIREMENT. The first is how many columns the table has, and
// the second is how many of them the deal actually dealt into. Both are needed
// because either alone is satisfiable without the other: a build whose state
// declares seven columns and deals into six reports seven columns holding a gap,
// and a build that deals into every column it has is right only if it has seven.
// Together they say the deal reached seven columns, which is what the point is.
//
// HOW IT IS REACHED. `openTable` resets, enters play and clears all thirteen
// piles, so a column holding cards afterwards is one this deal dealt into rather
// than one left standing; then `deal()`, which is the game's own deal path rather
// than a pose (specs/instrumentation.md), lays the board.
//
// WHAT THIS CHECK DOES NOT DECIDE. How many cards each column receives is
// deal/column-sizes, so a build that gives every column four cards passes here
// and fails there; which of them are face-up is deal/lowest-face-up and
// deal/rest-face-down.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { TABLEAU_COLUMNS } from "../constants";
import {
  captureStill,
  createHarness,
  openTable,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("deals the tableau across seven columns", async () => {
  await openTable(h);
  await h.debug.deal();
  await h.advance(1);
  await captureStill(h, "dealt");

  const { tableau } = await h.snapshot();
  assertLength(
    tableau,
    TABLEAU_COLUMNS,
    "columns the table lays the tableau out in (specs/deal.md)",
  );
  assertEqual(
    tableau.filter((column) => column.length > 0).length,
    TABLEAU_COLUMNS,
    "columns the deal dealt at least one card into (specs/deal.md)",
  );
});
