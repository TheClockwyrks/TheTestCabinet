// handling/press-bare-table-grabs-nothing — a press on the bare table lifts
// nothing.
//
// THE RULE. specs/controls.md: "A press that lands on no card lifts nothing."
//
// WHERE THE PRESS LANDS. The middle of the gap between two columns.
// specs/table.md spaces the seven columns at a pitch of `122`, "which is a `100`-
// wide card and a `22` gap", and says of those gaps that they "carry no pile and
// nothing card-sized is drawn in them". Column 0 runs to `x = 324` and column 1
// begins at `x = 346`, so `x = 335` is eleven units clear of both, and `y = 250`
// is the height a column's first card is drawn at (`TABLEAU_Y` is `180`, a card
// is `140` tall). The point lies in no pile's drop rectangle either.
//
// THE COLUMN BESIDE IT HOLDS A CARD, deliberately. An empty table would pass a
// build with no hit test at all, because there would be nothing for it to lift.
// With a card one gap away, a build that answers a press with the nearest pile,
// or that reads a column's band as wider than the `100` specs/table.md fixes,
// puts that card in the hand and fails.
//
// WHAT IS READ. `drag` stays null, and the column beside the press still holds
// its card — a lift takes the run off its pile the moment it enters the hand
// (specs/controls.md), so a build that lifted and then dropped the reference to
// it is caught by the second reading.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertNull } from "../assert";
import {
  captureStill,
  card,
  createHarness,
  openTable,
  poseColumn,
  pressAt,
  SEVEN,
  type Harness,
} from "../harness";
import { pileText } from "./gestures";

/** The column that holds the one card on the table. */
const COLUMN = 0;
const CARDS = [card("spades", SEVEN)];
const UNCHANGED = ["7S"];

/**
 * The press point: the middle of the 22-unit gap between column 0's right edge
 * (`224 + 100 = 324`) and column 1's left edge (`346`), at the height of the
 * columns' first card (specs/table.md).
 */
const BARE_X = 335;
const BARE_Y = 250;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves the hand empty when the press lands in the gap between two columns", async () => {
  openTable(h);
  poseColumn(h, COLUMN, CARDS);

  pressAt(h, BARE_X, BARE_Y);
  const after = h.snapshot();
  await h.advance(1);
  captureStill(h, "unheld");

  assertNull(
    after.drag,
    `the run in hand after a press at (${String(BARE_X)}, ${String(BARE_Y)}), ` +
      "in the gap between two columns, where no card is drawn " +
      "(specs/controls.md, specs/table.md)",
  );
  assertDeepEqual(
    pileText(after.tableau[COLUMN]),
    UNCHANGED,
    `column ${COLUMN}, one gap from the press: nothing was lifted, so nothing ` +
      "left it (specs/controls.md)",
  );
});
