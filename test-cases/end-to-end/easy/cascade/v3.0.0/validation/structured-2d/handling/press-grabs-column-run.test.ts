// handling/press-grabs-column-run — a press on a column card lifts that card and
// every card below it.
//
// THE RULE. specs/controls.md: a press resolves to "the card drawn over every
// other card at the press point, which in a column is the lowest of the cards
// whose footprint contains that point", and on a face-up card in a column it
// lifts "that card and every card below it in the column, as the run
// specs/tableau.md defines". It lifts on the press itself, "before the pointer
// has moved at all", and the run "leaves the pile it was lifted from as it enters
// the hand", so both halves are readable from `snapshot()` with no frame advanced
// and no pointer motion at all (specs/instrumentation.md: a pointer operation
// resolves its event before the call returns).
//
// THE PRESS IS ON THE MIDDLE OF THREE FACE-UP CARDS, deliberately. The column
// holds a face-down card and then three face-up cards in run order — 8S, 7H, 6C,
// each one rank lower and the opposite colour — and the press lands on the 7H.
// So every wrong model reads as a different hand:
//
//   the grabbed card and below (the rule)  ->  ["7H", "6C"]
//   the grabbed card alone                 ->  ["7H"]
//   the column's whole face-up run         ->  ["8S", "7H", "6C"]
//   the column's exposed card              ->  ["6C"]
//   the grabbed card and the cards ABOVE   ->  ["8S", "7H"]
//
// WHERE THE PRESS LANDS. `grabPoint` is the point that resolves to a named row
// under the rule above: the band between that card's own top edge and the top
// edge of the card drawn below it, since the centre of a card that has cards
// below it lies on those cards too.
//
// THE TABLE HOLDS ONE COLUMN. `openTable` clears all thirteen piles and the
// waste's set memory, and the requirement concerns one press on one column, so
// nothing else is posed and no gate is touched.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNotNull } from "../assert";
import {
  captureStill,
  card,
  createHarness,
  down,
  EIGHT,
  grabPoint,
  NINE,
  openTable,
  poseColumn,
  pressAt,
  SEVEN,
  SIX,
  type Harness,
} from "../harness";
import { pileText } from "./gestures";

/** The column in play. Any of the seven behaves the same (specs/table.md). */
const COLUMN = 2;

/**
 * The column, bottom-most card first, so the last entry is the one drawn lowest
 * on the table. A face-down card at the top, then three face-up cards in run
 * order (specs/tableau.md).
 */
const CARDS = [
  down(card("diamonds", NINE)),
  card("spades", EIGHT),
  card("hearts", SEVEN),
  card("clubs", SIX),
];

/** The row the press lands on: the middle of the three face-up cards. */
const GRAB_ROW = 2;

/** The run that press must put in the hand: the 7H and the card below it. */
const HELD = ["7H", "6C"];

/** What the column is left holding while the run is in hand. */
const LEFT_BEHIND = ["#9D", "8S"];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("puts the grabbed card and every card below it in the hand, in order", async () => {
  openTable(h);
  poseColumn(h, COLUMN, CARDS);

  const at = grabPoint(h.snapshot(), COLUMN, GRAB_ROW);
  pressAt(h, at.x, at.y);
  const held = h.snapshot();
  await h.advance(1);
  captureStill(h, "held");

  assertNotNull(
    held.drag,
    `the run in hand after a press on row ${GRAB_ROW} of column ${COLUMN}, ` +
      "which enters the hand on the press itself (specs/controls.md)",
  );
  assertDeepEqual(
    pileText(held.drag?.cards ?? []),
    HELD,
    "the cards in hand: the card the press resolved to and every card below " +
      "it in the column, in order (specs/controls.md, specs/tableau.md)",
  );
  assertEqual(
    held.drag?.fromPile,
    "tableau",
    "the pile the run was lifted from (specs/instrumentation.md)",
  );
  assertEqual(
    held.drag?.fromIndex,
    COLUMN,
    "the column the run was lifted from (specs/instrumentation.md)",
  );
  assertDeepEqual(
    pileText(held.tableau[COLUMN]),
    LEFT_BEHIND,
    `column ${COLUMN} while the run is held: the run leaves the pile as it ` +
      "enters the hand, so only the cards above it are left (specs/controls.md)",
  );
});
