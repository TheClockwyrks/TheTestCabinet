// handling/no-highlight-illegal — a pile that would refuse the run is not
// reported.
//
// THE RULE. specs/controls.md: "A pile is the drop target only while the release
// rule below would resolve the run to it AND that pile accepts the run." So both
// halves must hold, and this point decides the second: the run is carried until
// the release rule resolves it to a pile, and that pile is one specs/tableau.md
// has refuse it.
//
// WHERE THE RUN IS CARRIED. specs/controls.md resolves a drop "to the pile whose
// drop rectangle contains the center of the run's leading card", and
// specs/table.md fixes those rectangles — a column holding cards answers inside
// `CARD_W` wide at its own `COLUMN_X`, from `TABLEAU_Y` down to its lowest card's
// bottom edge. The run is carried until its leading card sits on the target
// column's anchor, and the check reads back that the card's centre really is
// inside that rectangle before it reads the report: without that, a build that
// carried the run somewhere else entirely would pass by reporting null about a
// pile the run was never over.
//
// WHY THE PILE REFUSES. A red five onto a red six is one rank lower but the SAME
// colour, and specs/tableau.md has a column accept only "a run led by a card of
// rank `r - 1` and the colour other than `c`". `handling/drop-target-highlights`
// poses the same board with a black six and decides the other direction, so a
// build that reports every pile under the run and one that reports none grade
// differently.
//
// THE SOURCE COLUMN EMPTIES ON THE LIFT, and an empty column accepts only a run
// led by a King (specs/tableau.md), so no other pile on the table could be
// reported either.

import { afterEach, beforeEach, it } from "vitest";
import { assertNotNull, assertNull, assertTrue } from "../assert";
import { CARD_H, CARD_W } from "../constants";
import {
  captureStill,
  card,
  cardTopLeft,
  createHarness,
  dropRectIn,
  FIVE,
  grabPoint,
  inRect,
  openTable,
  pileTopLeft,
  poseColumn,
  pressAt,
  movePointerTo,
  SIX,
  type Harness,
} from "../harness";
import { carryTo } from "./gestures";

/** The column the run is lifted from, and the column it is carried over. */
const FROM_COLUMN = 0;
const TO_COLUMN = 1;
const FROM_ROW = 0;

/** A red five over a red six: one rank lower, the SAME colour, so refused. */
const RUN = card("hearts", FIVE);
const TARGET = card("diamonds", SIX);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves dropTarget null while the run is over a column that refuses it", async () => {
  openTable(h);
  poseColumn(h, FROM_COLUMN, [RUN]);
  poseColumn(h, TO_COLUMN, [TARGET]);

  const posed = h.snapshot();
  const press = grabPoint(posed, FROM_COLUMN, FROM_ROW);
  const lead = cardTopLeft(posed, "tableau", FROM_COLUMN, FROM_ROW);
  const over = carryTo(press, lead, pileTopLeft("tableau", TO_COLUMN));

  pressAt(h, press.x, press.y);
  movePointerTo(h, over.x, over.y);
  const held = h.snapshot();
  await h.advance(1);
  captureStill(h, "unhighlighted");

  assertNotNull(
    held.drag,
    "the run in hand as it is carried, which the press put there " +
      "(specs/controls.md)",
  );
  // The precondition the rule is about: the release rule WOULD resolve this run
  // to the refusing column, so a null report is a decision and not an accident.
  const rect = dropRectIn(held, "tableau", TO_COLUMN);
  assertTrue(
    inRect(
      rect,
      (held.drag?.x ?? Number.NaN) + CARD_W / 2,
      (held.drag?.y ?? Number.NaN) + CARD_H / 2,
    ),
    `the leading card's centre lies inside column ${String(TO_COLUMN)}'s drop ` +
      "rectangle, which is where the release rule resolves a drop " +
      "(specs/controls.md, specs/table.md)",
  );
  assertNull(
    held.dropTarget,
    "snapshot().dropTarget with the red five's centre inside column " +
      `${String(TO_COLUMN)}'s drop rectangle, a column whose red six refuses ` +
      "it (specs/controls.md, specs/tableau.md)",
  );
});
