// table/foundation-anchors — the four foundations sit at 590, 712, 834 and 956.
//
// THE RULE. `specs/table.md` fixes `FOUNDATION_X` as `[590, 712, 834, 956]` and
// anchors foundation `i` at `(FOUNDATION_X[i], TOP_ROW_Y)`, `(…, 24)`. It also
// fixes what sits between the two draw piles and the foundations: "The third
// column position, `x = 468`, carries no pile in the top row", and nothing
// card-sized is drawn there — under Draw Three the one thing over any of that
// space is the right end of the waste's fan, whose cards begin at `346`, `372`
// and `398` and never take a corner at `468`.
//
// THE POSE. One card on each of the four foundations — an Ace, which is the only
// card a foundation legally starts with (`specs/foundations.md`), though a pose
// asks the rules nothing — and every other pile left empty. The four are then the
// only piles in the top row holding cards, and the stock and the waste draw the
// card-sized mark `specs/table.md` gives an empty pile at their own anchors. The
// waste is empty under either deal mode, so nothing fans and the gap at `468`
// carries nothing at all.
//
// WHAT IS READ, IN THREE DIRECTIONS.
//
//   1. A card-sized shape sits at each of the four anchors, so all four are
//      placed and a build that spaced them at a pitch of its own is named for the
//      first one it missed.
//   2. Nothing card-sized takes a corner at `(468, 24)`, which is the clause
//      `specs/table.md` states about the gap itself: a build that laid five
//      evenly spaced foundations from `468`, or that anchored the first of four
//      there, puts one exactly on it.
//   3. No card-sized shape sits away from all thirteen anchors — the same reading
//      as the two directions above, taken over the rest of the table, so a
//      foundation drawn at a position that is neither its own anchor nor the gap
//      is named for where it landed.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertGreaterThan } from "../assert";
import {
  COLUMN_X,
  FOUNDATION_X,
  STOCK_X,
  SUITS,
  TABLEAU_Y,
  TOP_ROW_GAP_X,
  TOP_ROW_Y,
  WASTE_X,
} from "../constants";
import {
  captureStill,
  cardFootprints,
  createHarness,
  openTable,
  poseFoundation,
  type Harness,
  type Point,
} from "../harness";

/** The rank posed on each foundation: the Ace a foundation starts with. */
const ACE = 1;

/** The thirteen anchors `specs/table.md` fixes for the thirteen piles. */
const ANCHORS: Point[] = [
  { x: STOCK_X, y: TOP_ROW_Y },
  { x: WASTE_X, y: TOP_ROW_Y },
  ...FOUNDATION_X.map((x) => ({ x, y: TOP_ROW_Y })),
  ...COLUMN_X.map((x) => ({ x, y: TABLEAU_Y })),
];

/**
 * How far a painted shape's size may sit from the card footprint and still be
 * read as a card, in logical units: room for the unit a build loses insetting a
 * stroke, on a footprint `table/card-size` grades.
 */
const CARD_SIZE_TOLERANCE = 2;

/**
 * How far a card's corner may sit from an anchor and still be read as sitting on
 * it, in logical units. The same allowance, applied to the corner; the four
 * foundations are `122` units apart and the gap this reads is `122` left of the
 * first of them.
 */
const PLACEMENT_TOLERANCE = 2;

/** Whether a corner sits on `anchor`, within the placement tolerance. */
function sitsOn(corner: Point, anchor: Point): boolean {
  return (
    Math.abs(corner.x - anchor.x) <= PLACEMENT_TOLERANCE &&
    Math.abs(corner.y - anchor.y) <= PLACEMENT_TOLERANCE
  );
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws each foundation at its anchor and nothing in the gap", async () => {
  await openTable(h);
  for (const [index, suit] of SUITS.entries()) {
    await poseFoundation(h, index, suit, ACE);
  }

  const calls = await h.frameCalls();
  await captureStill(h, "foundations");

  const drawn = cardFootprints(calls, CARD_SIZE_TOLERANCE);

  for (const [index, x] of FOUNDATION_X.entries()) {
    assertGreaterThan(
      drawn.filter((corner) => sitsOn(corner, { x, y: TOP_ROW_Y })).length,
      0,
      `card-sized shapes drawn at foundation ${index}'s anchor ` +
        `(${x}, ${TOP_ROW_Y}), where the Ace this scenario put on it sits; the ` +
        "foundation holds a card, so nothing there is the mark an empty pile " +
        "draws (specs/table.md)",
    );
  }

  const inTheGap = drawn.filter((corner) =>
    sitsOn(corner, { x: TOP_ROW_GAP_X, y: TOP_ROW_Y }),
  );
  assertDeepEqual(
    inTheGap.map((corner) => [Math.round(corner.x), Math.round(corner.y)]),
    [],
    `the corners of the card-sized shapes drawn at (${TOP_ROW_GAP_X}, ` +
      `${TOP_ROW_Y}), the third column position, which carries no pile in the ` +
      "top row (specs/table.md)",
  );

  const stray = drawn.filter((corner) =>
    ANCHORS.every((at) => !sitsOn(corner, at)),
  );
  assertDeepEqual(
    stray.map((corner) => [Math.round(corner.x), Math.round(corner.y)]),
    [],
    "the corners of the card-sized shapes drawn away from all thirteen pile " +
      "anchors: the four foundations are the only piles holding cards and the " +
      "other nine draw their marks at their own anchors, so a shape anywhere " +
      "else is a foundation's card off its anchor (specs/table.md)",
  );
});
