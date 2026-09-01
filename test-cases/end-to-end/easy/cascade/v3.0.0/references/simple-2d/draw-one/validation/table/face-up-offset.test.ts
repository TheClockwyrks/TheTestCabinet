// table/face-up-offset — the card under a face-up card is 34 units lower.
//
// THE RULE. specs/table.md fans a column downward, "each one offset below the card
// above it by" `FACE_UP_OFFSET` (`34`) when "the card above is" face-up. The gap
// is a property of the card ABOVE it, and it is the offset a column draws for as
// long as it fits: "when a column's natural extent at the offsets above would
// pass that line, its face-up offset is reduced" — so the uncompressed figure is
// read on a column that comes nowhere near the line.
//
// THE SCENARIO IS A COLUMN SHORT ENOUGH TO NEED NO COMPRESSION. Three face-up
// cards reach `180 + 2 x 34 + 140 = 388`, stopping `288` units short of
// `COLUMN_BOTTOM_LIMIT` (`676`), so the fit leaves the offset alone and what is
// drawn is the plain `34`. Both
// gaps are read, so a build that offsets its last card differently from the rest
// is named here rather than passing on one of the two.
//
// WHAT IS ASSERTED IS THE DIFFERENCE, not any card's own position, and the column
// is found as the place the frame drew the most cards rather than by its anchor
// (see `./geometry.ts`). So a build whose columns sit at the wrong pitch, or whose
// tableau row starts too low, is charged to `table/column-anchors` and
// `table/tableau-anchor-y` and still has its overlap graded here.
//
// THE FACE-DOWN GAP IS NOT READ HERE. Every card in this column is face-up, so
// the only offset in it is the one this point decides, and
// `table/face-down-offset` poses its own column for the other.

import { afterEach, beforeEach, it } from "vitest";
import { FACE_UP_OFFSET } from "../../src/constants";
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
 * How far a drawn gap may sit from `FACE_UP_OFFSET`, in logical units.
 *
 * `34` is exact in specs/table.md, so this is not an overlap allowance: it is the
 * unit a build may lose insetting a stroke inside the footprint it draws, the same
 * room `harness.ts` reads a card-sized box with (`CARD_BOX_TOLERANCE`). The other
 * figures the specification names for a column gap — `FACE_DOWN_OFFSET` (`24`) and
 * `FACE_UP_OFFSET_MIN` (`14`) — are ten and twenty units away, so a build that
 * drew either of them here reads as a different number.
 */
const OFFSET_TOLERANCE = 2;

/** The column the run is posed on, and the run: three face-up cards. */
const COLUMN = 3;
const CARDS = ["9H", "8S", "7D"];

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("offsets the card under a face-up card by the face-up offset", async () => {
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
      FACE_UP_OFFSET - OFFSET_TOLERANCE,
      FACE_UP_OFFSET + OFFSET_TOLERANCE,
      `the drawn gap under the face-up card at row ${row} of an ` +
        `uncompressed column, FACE_UP_OFFSET (specs/table.md)`,
    );
  }
});
