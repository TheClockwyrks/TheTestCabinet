// table/card-size — a card covers its 100 x 140 footprint wherever it sits.
//
// THE RULE. `specs/table.md`: "Every card occupies a `CARD_W x CARD_H`
// (`100 x 140`) rectangle. That is its footprint wherever it sits: in a pile,
// overlapped in a column, held in hand, or in flight during the victory cascade."
//
// THE POSE, AND WHY IT IS FOUR PLACES RATHER THAN ONE. "Wherever it sits" is the
// whole of the rule, so the reading is taken at four positions of three different
// kinds: a card at a pile's own anchor in the top row, a card at a column's
// anchor, and two cards overlapped below it in that column, each at a position no
// pile is anchored on. A build that sizes a squared card correctly and shrinks an
// overlapped one — or that draws its columns at a scale of its own — is caught by
// the rows below the first.
//
// Column 2 is the column posed because `COLUMN_X[2]` (`468`) is the one column
// anchor that no top-row pile shares, so nothing else on the table can put a
// shape at that `x`. Foundation 1 carries the top-row card, and it holds a card,
// so the card-sized mark `specs/table.md` gives an EMPTY pile is not drawn there
// and the shape read at that anchor is the card.
//
// WHAT IS READ. Every shape the frame painted whose top-left corner is the
// position under test, as a BOX — the extent is the whole question here, so this
// reads `paintedBoxes` rather than `cardFootprints`, which filters by that extent
// before handing anything back. A card is drawn as more than one shape by both of
// this case's own reference builds (an outer plate with an inset panel over it),
// so what is required is that ONE of the shapes at the card's corner covers the
// footprint: the closest of them is compared against `100 x 140`, and a build
// whose largest shape at that corner is `90 x 120` has no shape that covers it.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertLessThanOrEqual } from "../assert";
import {
  CARD_H,
  CARD_W,
  COLUMN_X,
  FACE_UP_OFFSET,
  FOUNDATION_X,
  TABLEAU_Y,
  TOP_ROW_Y,
} from "../constants";
import {
  captureStill,
  columnOfCards,
  createHarness,
  openTable,
  paintedBoxes,
  poseColumn,
  poseFoundation,
  type DrawCall,
  type Harness,
  type Rect,
} from "../harness";

/** The column posed, chosen because no top-row pile is anchored on its `x`. */
const COLUMN = 2;

/** Three face-up cards, so two of them sit overlapped below the column's anchor. */
const COLUMN_CARDS = 3;

/** The foundation the top-row card is posed on. */
const FOUNDATION = 1;

/**
 * The four positions a card sits at in this scenario, from the offsets
 * `specs/table.md` fixes: the foundation's anchor, the column's anchor, and the
 * two face-up offsets below it. Three cards, all face-up, reach `y = 248`, whose
 * bottom edge is `388` — well above `COLUMN_BOTTOM_LIMIT` (`676`), so nothing
 * here is compressed.
 */
const POSITIONS = [
  { x: FOUNDATION_X[FOUNDATION], y: TOP_ROW_Y, where: "on a foundation" },
  { x: COLUMN_X[COLUMN], y: TABLEAU_Y, where: "at a column's anchor" },
  {
    x: COLUMN_X[COLUMN],
    y: TABLEAU_Y + FACE_UP_OFFSET,
    where: "overlapped in a column",
  },
  {
    x: COLUMN_X[COLUMN],
    y: TABLEAU_Y + FACE_UP_OFFSET * 2,
    where: "overlapped twice in a column",
  },
] as const;

/**
 * How far a shape's corner may sit from a position and still be read as the shape
 * drawn AT it, in logical units.
 *
 * Room for the unit a build loses tracing its card's outline down the centre-line
 * of a stroke rather than along its outer edge. It is deliberately smaller than
 * the size tolerance below is generous, because the inner panel a build insets
 * over its card starts at the card's corner plus its own inset and would
 * otherwise be read as a candidate for the footprint — and because the two
 * offsets this scenario steps by are `34` apart.
 */
const PLACEMENT_TOLERANCE = 2;

/**
 * How far the closest shape at a card's corner may sit from `100 x 140` and still
 * be said to cover the footprint, in logical units.
 *
 * The same allowance for a stroke traced down its centre-line, applied to the
 * extent: a build that draws its card as a `strokeRect` two units wide inset to
 * sit inside the footprint names `98 x 138` and covers `100 x 140`. `specs/`
 * fixes no line width, so two units is the room this leaves. A build that sized
 * its cards wrongly at all misses by tens of units: the next plausible footprint
 * down, a card scaled to nine tenths, is `10` short across and `14` short down.
 */
const SIZE_TOLERANCE = 2;

/** A measured extent, to a tenth of a unit, for a failure message. */
function round(value: number): number {
  return Math.round(value * 10) / 10;
}

/** The shapes the frame painted whose top-left corner is `(x, y)`. */
function boxesAt(calls: readonly DrawCall[], x: number, y: number): Rect[] {
  return paintedBoxes(calls).filter(
    (box) =>
      Math.abs(box.x - x) <= PLACEMENT_TOLERANCE &&
      Math.abs(box.y - y) <= PLACEMENT_TOLERANCE,
  );
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("covers 100 x 140 at every position a card sits at", async () => {
  await openTable(h);
  await poseFoundation(h, FOUNDATION, "spades", 1);
  await poseColumn(h, COLUMN, columnOfCards(COLUMN_CARDS));

  const calls = await h.frameCalls();
  await captureStill(h, "card");

  for (const { x, y, where } of POSITIONS) {
    const boxes = boxesAt(calls, x, y);
    assertGreaterThan(
      boxes.length,
      0,
      `shapes drawn at (${x}, ${y}), where this scenario put a card ${where} ` +
        "(specs/table.md)",
    );
    const deviation = Math.min(
      ...boxes.map((box) =>
        Math.max(Math.abs(box.w - CARD_W), Math.abs(box.h - CARD_H)),
      ),
    );
    assertLessThanOrEqual(
      deviation,
      SIZE_TOLERANCE,
      `how far the closest shape drawn at (${x}, ${y}) sits from the ` +
        `${CARD_W} x ${CARD_H} footprint a card occupies wherever it sits, ` +
        `here ${where}; the shapes drawn there measured ` +
        boxes.map((box) => `${round(box.w)} x ${round(box.h)}`).join(", ") +
        " (specs/table.md)",
    );
  }
});
