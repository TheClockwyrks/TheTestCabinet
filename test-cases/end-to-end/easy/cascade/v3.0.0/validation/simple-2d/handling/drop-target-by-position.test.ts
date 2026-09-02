// handling/drop-target-by-position — a drop resolves to the pile whose rectangle
// holds the leading card's center, not to one the card merely overlaps and not to
// the pile under the pointer.
//
// specs/controls.md: "A drop resolves to the pile whose drop rectangle contains the
// CENTER OF THE RUN'S LEADING CARD, that card being the one drawn at the top of the
// held run. The rectangles do not overlap, so that center lies in at most one of
// them." specs/table.md fixes the rectangles: a column holding cards answers
// `CARD_W` wide at its own `COLUMN_X`, running from `TABLEAU_Y` down to the bottom
// edge of its lowest drawn card.
//
// THE SCENARIO SEPARATES THE THREE MODELS A BUILD MIGHT HAVE IMPLEMENTED, by leaving
// the card straddling two columns that would BOTH take it and the pointer over
// neither:
//
//   - The center is `12` units inside the right-hand column's rectangle, so the rule
//     resolves the drop to that column.
//   - The card's left edge is `38` units further left, `16` units inside the
//     left-hand column's rectangle, so a build that resolves a drop by which
//     rectangles the card OVERLAPS has two piles to choose from and the left-hand one
//     comes first.
//   - The press is `20` units left of the card's center, so the pointer is left in
//     the `22`-unit gap between the two columns, in no rectangle at all, and a build
//     that resolves the drop against the POINTER rather than against the leading
//     card returns the run to its source instead.
//
// BOTH COLUMNS ACCEPT. Each is led by a black six and the run is the red five, which
// specs/tableau.md has a column accept, so no build is rescued from a wrong choice by
// the rules refusing it: whichever pile it picked is the pile the card is found on.
//
// THE SOURCE IS A THIRD COLUMN, well to the right of both, so the run has left a pile
// that neither reading could confuse with a target.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual } from "../assert";
import { COLUMN_X, TABLEAU_Y } from "../constants";
import {
  captureStill,
  createHarness,
  drag,
  openTable,
  pileSpecs,
  poseColumn,
  type Harness,
  type Point,
} from "../harness";
import { releaseForCenter } from "./aim";

/** The column the run is lifted from, and the run: one red five. */
const FROM_COLUMN = 5;
const RUN = "5H";

/** The column whose rectangle holds the center, and the card it is led by. */
const TARGET_COLUMN = 2;
const TARGET_CARD = "6C";

/** The column the card only overlaps, and the card it is led by. */
const OVERLAPPED_COLUMN = 1;
const OVERLAPPED_CARD = "6S";

/**
 * How far inside the target column's rectangle the leading card's center is left.
 *
 * Small on purpose. The card is `CARD_W` (`100`) wide, so a center `12` units inside
 * one rectangle leaves the card's left edge `38` units outside it, which is `16`
 * units inside the rectangle of the column before it — the overlap the item names.
 */
const CENTER_INSET = 12;

/**
 * Where the press lands inside the source card, measured from its top-left.
 *
 * `20` units left of the card's center, so the pointer trails the leading card's
 * center by `20` units for the whole gesture and is left in the gap between the two
 * columns while the center is inside the second of them.
 */
const PRESS_OFFSET = { x: 30, y: 70 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("resolves the drop to the pile holding the leading card's center", async () => {
  openTable(h);
  poseColumn(h, FROM_COLUMN, [RUN]);
  poseColumn(h, OVERLAPPED_COLUMN, [OVERLAPPED_CARD]);
  poseColumn(h, TARGET_COLUMN, [TARGET_CARD]);

  const lead: Point = { x: COLUMN_X[FROM_COLUMN], y: TABLEAU_Y };
  const press: Point = {
    x: lead.x + PRESS_OFFSET.x,
    y: lead.y + PRESS_OFFSET.y,
  };
  const center: Point = {
    x: COLUMN_X[TARGET_COLUMN] + CENTER_INSET,
    y: TABLEAU_Y + PRESS_OFFSET.y,
  };
  drag(h, press, releaseForCenter(center, press, lead));
  const after = h.snapshot();
  await h.advance(1);
  captureStill(h, "resolved");

  assertDeepEqual(
    pileSpecs(after.tableau[TARGET_COLUMN]),
    [TARGET_CARD, RUN],
    `column ${TARGET_COLUMN} after the drop: its rectangle holds the leading ` +
      `card's center, ${CENTER_INSET} units inside its left edge, so the drop ` +
      "resolves to it (specs/controls.md, specs/table.md)",
  );
  assertDeepEqual(
    pileSpecs(after.tableau[OVERLAPPED_COLUMN]),
    [OVERLAPPED_CARD],
    `column ${OVERLAPPED_COLUMN} after the drop: the card overlaps its ` +
      "rectangle but its center lies outside, so this column takes nothing " +
      "(specs/controls.md)",
  );
  assertDeepEqual(
    pileSpecs(after.tableau[FROM_COLUMN]),
    [],
    `column ${FROM_COLUMN} after the drop: the run left its source, so the ` +
      "drop resolved to a pile rather than returning (specs/controls.md)",
  );
});
