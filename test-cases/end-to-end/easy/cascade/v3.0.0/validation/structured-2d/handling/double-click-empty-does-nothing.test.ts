// handling/double-click-empty-does-nothing — two quick presses on the bare table
// change nothing.
//
// THE RULE. specs/controls.md: a press is a double click only when, among the
// three conditions, "it lands on a playable card". A press on bare table lands on
// no card at all, so the pair is two ordinary clicks; and "A press that lands on no
// card lifts nothing", while a click activates only "the control whose hit
// rectangle contains the press point, when the press point lies in one" and turns
// the stock only when the press lies in the stock's rectangle. The gap between two
// columns is neither, so the board is left exactly as it was.
//
// WHERE THE PRESSES LAND. The middle of the 22-unit gap between column 0's right
// edge (`224 + 100 = 324`) and column 1's left edge (`346`), at the height of the
// columns (specs/table.md, which says the gaps "carry no pile and nothing
// card-sized is drawn in them"). Both presses land on the same point, so the window
// and the slop conditions both hold and the only condition failing is the one this
// point is about.
//
// THE TABLE IS NOT EMPTY, deliberately. A foundation holds the Ace of spades and a
// column holds the two of spades, which is exactly the board
// `handling/double-click-auto-moves` sends home. So a build that answers a double
// click by looking for SOMETHING playable rather than for the card under the press
// sends that two home here and fails, and a build with no hit test at all does the
// same.
//
// WHAT IS READ. The thirteen piles and the waste's set memory, before the gesture
// and again after it, and the hand. "Nothing" is not one field: a check that read
// only the column would pass a build that disturbed a foundation.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertNull } from "../assert";
import {
  ACE,
  captureStill,
  card,
  createHarness,
  doubleClickAt,
  openTable,
  poseColumn,
  poseFoundation,
  poseStock,
  TWO,
  type Harness,
} from "../harness";
import { boardText } from "./gestures";

/** The board the gesture must not disturb: one started foundation, one column. */
const FOUNDATION = 0;
const SUIT = "spades";
const COLUMN = 0;
const CARDS = [card(SUIT, TWO)];
/** And a stock, so a build that turned it on a stray click is caught too. */
const STOCK = [card("hearts", ACE), card("hearts", TWO)];

/**
 * The press point: the middle of the gap between column 0 and column 1, at the
 * height of the columns' first card (specs/table.md).
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

it("leaves the whole board as it was when two quick presses land on bare table", async () => {
  openTable(h);
  poseFoundation(h, FOUNDATION, SUIT, ACE);
  poseColumn(h, COLUMN, CARDS);
  poseStock(h, STOCK);

  const before = boardText(h.snapshot());
  doubleClickAt(h, BARE_X, BARE_Y);

  const after = h.snapshot();
  await h.advance(1);
  captureStill(h, "unchanged");

  assertDeepEqual(
    boardText(after),
    before,
    "the thirteen piles and the waste's set memory after two quick presses at " +
      `(${String(BARE_X)}, ${String(BARE_Y)}), in the gap between two columns: ` +
      "a press on no card is no double click, lifts nothing and activates " +
      "nothing (specs/controls.md, specs/table.md)",
  );
  assertNull(
    after.drag,
    "the run in hand after the gesture: a press that lands on no card lifts " +
      "nothing (specs/controls.md)",
  );
});
