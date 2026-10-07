// table/column-anchors — the seven columns are laid at a pitch of 122 from 224.
//
// THE RULE. `specs/table.md`: "The seven columns are evenly spaced, at a pitch of
// `122`, which is a `100`-wide card and a `22` gap", with `COLUMN_X` holding
// their left edges, `224, 346, 468, 590, 712, 834, 956`. And: "The gaps between
// the columns carry no pile and nothing card-sized is drawn in them."
//
// THE POSE. One face-up card on each of the seven columns and every top-row pile
// left empty, so the tableau half of the table carries seven cards and nothing
// else. One card per column rather than several: this point decides the `x` of a
// column and nothing about how its cards fan, so a column is posed with the
// fewest cards that make it a column holding cards at all.
//
// WHAT IS READ, AND WHY THE BAND IS BY `y`. `specs/table.md` fixes that "the top
// row's rectangles end at `y = 164` and the columns' begin at `y = 180`", so
// every card-sized shape below `164` belongs to the tableau and every one above
// it to the top row — which is what keeps the top row's six empty marks out of
// this reading even though four of the column anchors are shared with the
// foundations'. Within that band:
//
//   1. A card-sized shape sits at each of the seven `COLUMN_X`, so all seven
//      columns are placed and a build that spaced them at a pitch of its own is
//      named for the first one it missed.
//   2. Every card-sized shape in the band sits at one of the seven, which is the
//      gap clause: a shape whose left edge is anywhere in the `22` units between
//      two columns is a card drawn in a gap.
//
// The `y` those cards are drawn at is `table/tableau-anchor-y`, and this check
// deliberately reads the whole band below `164` rather than the anchor row
// alone, so that a build with a correct pitch and a wrong `TABLEAU_Y` is docked
// there and passes here.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertGreaterThan } from "../assert";
import { CARD_H, COLUMN_X, TOP_ROW_Y } from "../constants";
import {
  captureStill,
  cardFootprints,
  columnOfCards,
  createHarness,
  openTable,
  poseColumn,
  type Harness,
} from "../harness";

/** One card on each column: the fewest that make a column hold cards at all. */
const CARDS_PER_COLUMN = 1;

/**
 * Where the tableau's half of the table begins.
 *
 * `specs/table.md` ends the top row's rectangles at `y = 164`, which is
 * `TOP_ROW_Y + CARD_H`, and begins the columns' at `TABLEAU_Y` (`180`). A
 * card-sized shape below this line is a column's; one above it is the top row's.
 */
const TABLEAU_BAND_TOP = TOP_ROW_Y + CARD_H;

/**
 * How far a painted shape's size may sit from the card footprint and still be
 * read as a card, in logical units: room for the unit a build loses insetting a
 * stroke, on a footprint `table/card-size` grades.
 */
const CARD_SIZE_TOLERANCE = 2;

/**
 * How far a card's left edge may sit from a column anchor and still be read as
 * sitting on it, in logical units.
 *
 * The same allowance, applied to the corner. It is a ninth of the `22`-unit gap
 * this point reads, so a card drawn anywhere in a gap is outside it, and the
 * columns it tells apart are `122` units across.
 */
const PLACEMENT_TOLERANCE = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("puts a column at each of the seven anchors and none in the gaps", async () => {
  await openTable(h);
  for (const index of COLUMN_X.keys()) {
    await poseColumn(h, index, columnOfCards(CARDS_PER_COLUMN));
  }

  const calls = await h.frameCalls();
  await captureStill(h, "columns");

  const inTableau = cardFootprints(calls, CARD_SIZE_TOLERANCE).filter(
    (corner) => corner.y > TABLEAU_BAND_TOP,
  );

  for (const [index, x] of COLUMN_X.entries()) {
    assertGreaterThan(
      inTableau.filter(
        (corner) => Math.abs(corner.x - x) <= PLACEMENT_TOLERANCE,
      ).length,
      0,
      `card-sized shapes drawn with their left edge at column ${index}'s ` +
        `anchor ${x}, where the card this scenario put on it sits ` +
        "(specs/table.md)",
    );
  }

  const inAGap = inTableau.filter((corner) =>
    COLUMN_X.every((x) => Math.abs(corner.x - x) > PLACEMENT_TOLERANCE),
  );
  assertDeepEqual(
    inAGap.map((corner) => [Math.round(corner.x), Math.round(corner.y)]),
    [],
    "the corners of the card-sized shapes the tableau drew away from the seven " +
      `column anchors ${COLUMN_X.join(", ")}: the columns are the only piles ` +
      "below the top row, so a shape whose left edge falls between two of them " +
      "sits in one of the 22-unit gaps, which carry no pile (specs/table.md)",
  );
});
