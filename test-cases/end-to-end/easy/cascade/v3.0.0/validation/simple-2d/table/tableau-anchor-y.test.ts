// table/tableau-anchor-y — a column's first card has its top edge at y = 180.
//
// THE RULE. specs/table.md starts each column at `TABLEAU_Y` (`180`): "a column's
// first card has its top edge at `y = 180`, and each further card's top edge is
// that many units below the one before it". This point decides the first card's
// top edge and nothing below it; the offsets under it are `table/face-down-offset`
// and `table/face-up-offset`.
//
// IT IS READ WITHOUT NAMING A COLUMN'S `x`. One card is posed on EVERY column, so
// the tableau row holds exactly seven cards and no empty column draws a slot, and
// then every card-sized box the frame drew that is not one of the six top-row
// slot marks is one of those seven first cards — whatever `x` the build put it at.
// So a build with the columns at the wrong pitch is charged to
// `table/column-anchors` and still has its top edge graded here, and a build with
// the pitch right and the row too low fails here alone.
//
// THE SIX TOP-ROW SLOTS ARE THE ONLY THING SET ASIDE, and they are set aside by
// their own top edge, `TOP_ROW_Y` (`24`), which specs/table.md fixes for the whole
// top row. That row is `156` above the tableau's, so nothing ambiguous sits
// between the two.
//
// NO GESTURE DRIVES IT: the cards are posed straight onto the columns.

import { afterEach, beforeEach, it } from "vitest";
import { COLUMN_X, TABLEAU_Y, TOP_ROW_Y } from "../../src/constants";
import { assertBetween, assertLength } from "../assert";
import {
  captureStill,
  cardBoxes,
  createHarness,
  drawFrame,
  drawnBoxes,
  openTable,
  poseColumn,
  type Harness,
} from "../harness";
import { CARD_SEARCH_TOLERANCE, cardCorners, clusterTops } from "./geometry";

/**
 * How far a first card's top edge may sit from `TABLEAU_Y`, in logical units.
 *
 * `180` is exact in specs/table.md; this is the unit an inset stroke costs,
 * matching `harness.ts`'s `CARD_BOX_TOLERANCE`. The smallest thing that could
 * move a first card — one face-down offset — is `24`, twelve times this.
 */
const ANCHOR_TOLERANCE = 2;

/**
 * How far a box's top edge may sit from `TOP_ROW_Y` and still be read as one of
 * the six top-row slot marks, in logical units.
 *
 * The same stroke allowance. The two rows are `156` apart, so nothing a column
 * drew can fall inside it.
 */
const TOP_ROW_TOLERANCE = 2;

/** One face-up card for each of the seven columns. */
const CARDS = ["2C", "4D", "6H", "8S", "10C", "QD", "KH"];

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("starts every column's first card at the tableau anchor y", async () => {
  openTable(harness);
  for (let column = 0; column < COLUMN_X.length; column += 1) {
    poseColumn(harness, column, [CARDS[column]]);
  }

  const calls = await drawFrame(harness);
  captureStill(harness, "column");

  const boxes = cardBoxes(drawnBoxes(harness, calls), CARD_SEARCH_TOLERANCE);
  // One card is drawn with as many calls as the build likes, so the seven cards
  // are the seven distinct top edges below the top row, not the seven boxes.
  const belowTopRow = boxes.filter(
    (box) => Math.abs(box.y - TOP_ROW_Y) > TOP_ROW_TOLERANCE,
  );
  const tops = clusterTops(belowTopRow);

  assertLength(
    tops,
    1,
    `distinct top edges among the cards the seven columns drew, one card each: ` +
      `every column's first card starts at the same y (specs/table.md); the ` +
      `card-sized boxes the frame drew below the top row were ` +
      `${cardCorners(belowTopRow).join(" ")}`,
  );

  assertBetween(
    tops[0],
    TABLEAU_Y - ANCHOR_TOLERANCE,
    TABLEAU_Y + ANCHOR_TOLERANCE,
    `the top edge of a column's first card, TABLEAU_Y (specs/table.md)`,
  );
});
