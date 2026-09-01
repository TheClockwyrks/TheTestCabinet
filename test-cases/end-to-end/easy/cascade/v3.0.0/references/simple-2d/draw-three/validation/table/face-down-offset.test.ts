// table/face-down-offset — the card under a face-down card is 24 units lower.
//
// THE RULE. specs/table.md fans a column downward, "each one offset below the card
// above it by" `FACE_DOWN_OFFSET` (`24`) when "the card above is" face-down. So the
// gap this point reads is a property of the card ABOVE it, not of the card below
// and not of the column's length.
//
// THE SCENARIO IS TWO BURIED CARDS AND THE ONE THEY BURY, which is the arrangement
// the deal itself makes (specs/deal.md): face-down cards with the exposed card
// under them. Three cards at this offset reach `180 + 24 + 24 + 140 = 368`, barely
// half of `COLUMN_BOTTOM_LIMIT` (`676`), so compression is nowhere near and what is
// read is the plain offset. Both gaps are read, so a build that offsets the first
// buried card correctly and the second some other way is named here.
//
// WHAT IS ASSERTED IS THE DIFFERENCE, not either card's own position, and the
// column is found as the place the frame drew the most cards rather than by its
// anchor (see `./geometry.ts`). So a build whose columns sit at the wrong pitch, or
// whose tableau row starts too low, is charged to `table/column-anchors` and
// `table/tableau-anchor-y` and still has its overlap graded here.
//
// THE FACE-UP GAP IS NOT READ HERE. Both offsets in one column would leave a
// failure unable to say which of the two the build got wrong, so every gap in this
// column is a face-down one and `table/face-up-offset` poses its own.

import { afterEach, beforeEach, it } from "vitest";
import { FACE_DOWN_OFFSET } from "../../src/constants";
import { assertBetween, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  drawFrame,
  openTable,
  poseColumn,
  type Harness,
} from "../harness";
import { drawnColumnGaps } from "./geometry";

/**
 * How far a drawn gap may sit from `FACE_DOWN_OFFSET`, in logical units.
 *
 * `24` is exact in specs/table.md, so this is not an overlap allowance: it is the
 * unit a build may lose insetting a stroke inside the footprint it draws, the same
 * room `harness.ts` reads a card-sized box with (`CARD_BOX_TOLERANCE`). The other
 * offset the specification names, `FACE_UP_OFFSET` (`34`), is ten units away and
 * the compression floor (`14`) another ten below, so a build that drew either of
 * them here reads as a different number and fails naming it.
 */
const OFFSET_TOLERANCE = 2;

/** The column the run is posed on, and it: two buried cards and the one they bury. */
const COLUMN = 2;
const CARDS = ["#6S", "#4H", "10D"];

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("offsets the card under a face-down card by the face-down offset", async () => {
  openTable(harness);
  poseColumn(harness, COLUMN, CARDS);

  const calls = await drawFrame(harness);
  captureStill(harness, "column");

  const gaps = drawnColumnGaps(harness, calls);
  assertLength(
    gaps,
    CARDS.length - 1,
    `gaps drawn in the column, which was posed with ${CARDS.length} cards`,
  );

  for (let row = 0; row < gaps.length; row += 1) {
    assertBetween(
      gaps[row],
      FACE_DOWN_OFFSET - OFFSET_TOLERANCE,
      FACE_DOWN_OFFSET + OFFSET_TOLERANCE,
      `the drawn gap under the face-down card at row ${row}, ` +
        `FACE_DOWN_OFFSET (specs/table.md)`,
    );
  }
});
