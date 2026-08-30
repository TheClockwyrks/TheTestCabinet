// table/column-anchors — the seven columns stand at 224, 346, 468, 590, 712, 834
// and 956, with the twenty-two-unit gaps between them bare.
//
// THE RULE. specs/table.md spaces the seven columns "at a pitch of `122`, which is
// a `100`-wide card and a `22` gap", and fixes their left edges in `COLUMN_X`. It
// then states what the spacing is FOR: "the gaps between the columns carry no pile
// and nothing card-sized is drawn in them".
//
// BOTH HALVES ARE THE ONE REQUIREMENT — the seven columns are laid out on that
// pitch. Reading only the anchors would pass a build that also drew a card across
// a gap; reading only the gaps would pass a build with no columns at all. Together
// they say the row is the row specs/table.md describes.
//
// A GAP IS READ AS A BAND, NOT AS A CORNER. A card drawn in a gap is one whose
// `100`-wide footprint REACHES into it, wherever its own left edge sits, so each
// of the six gaps is read as the band from one column's right edge to the next
// column's left edge and no card-sized box may overlap it.
//
// THE SCENARIO IS ONE CARD ON EACH COLUMN. Every column holds a card, so no column
// draws an empty slot and the seven boxes in the tableau row are the seven this
// point posed. The six top-row piles are left EMPTY on purpose: their slot marks
// sit at column positions (`224`, `346`, `590`, `712`, `834`, `956`) and so lie
// outside every gap, whereas a Draw Three waste showing a full fan reaches past
// `468` into the gap before it, which specs/table.md allows and this point must
// not read as a fault.
//
// ONLY THE `x` IS DECIDED HERE. That a column's first card starts at `y = 180` is
// `table/tableau-anchor-y`, so this point asserts nothing about the top edge.

import { afterEach, beforeEach, it } from "vitest";
import { CARD_W, COLUMN_X } from "../../src/constants";
import { fail } from "../assert";
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
import { cardCorners, overlapsBand } from "./geometry";

/**
 * How far a drawn card's left edge may sit from its column's `x`, in logical
 * units.
 *
 * `COLUMN_X` is exact in specs/table.md; this is the unit an inset stroke costs,
 * matching `harness.ts`'s `CARD_BOX_TOLERANCE`. The pitch is `122`, so a card
 * drawn against the wrong column misses by sixty times this.
 */
const ANCHOR_TOLERANCE = 2;

/**
 * How far a box may reach into a gap before it counts as drawn in it, in logical
 * units.
 *
 * A compliant card's right edge lands exactly on the gap's left edge, and a build
 * that strokes its footprint a unit outside puts a hairline over the boundary.
 * The gap is `22` wide, so a card really drawn in one overlaps it by tens of
 * units; two units of slack cannot hide that and does spare a stroke's width.
 */
const BAND_SLACK = 2;

/** One face-up card for each of the seven columns. */
const CARDS = ["AS", "3H", "5D", "7C", "9S", "JH", "KD"];

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("stands each column at its own x and leaves the gaps between them bare", async () => {
  openTable(harness);
  for (let column = 0; column < COLUMN_X.length; column += 1) {
    poseColumn(harness, column, [CARDS[column]]);
  }

  const calls = await drawFrame(harness);
  captureStill(harness, "columns");

  const boxes = cardBoxes(drawnBoxes(harness, calls));

  for (let column = 0; column < COLUMN_X.length; column += 1) {
    const anchorX = COLUMN_X[column];
    const found = boxes.some(
      (box) => Math.abs(box.x - anchorX) <= ANCHOR_TOLERANCE,
    );
    if (!found) {
      fail(
        `a card-sized box with its left edge at x = ${anchorX}, column ` +
          `${column}'s own x (specs/table.md), among the card-sized boxes the ` +
          `frame drew`,
        cardCorners(boxes),
      );
    }
  }

  for (let column = 0; column + 1 < COLUMN_X.length; column += 1) {
    const left = COLUMN_X[column] + CARD_W;
    const right = COLUMN_X[column + 1];
    const inGap = boxes.filter((box) =>
      overlapsBand(box, left, right, BAND_SLACK),
    );
    if (inGap.length > 0) {
      fail(
        `nothing card-sized drawn across the ${right - left}-unit gap from ` +
          `x = ${left} to x = ${right}, between columns ${column} and ` +
          `${column + 1} (specs/table.md)`,
        cardCorners(inGap),
      );
    }
  }
});
