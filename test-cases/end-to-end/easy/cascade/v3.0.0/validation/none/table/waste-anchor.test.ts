// table/waste-anchor — the waste's bottom-most shown card is drawn at (346, 24).
//
// THE RULE. `specs/table.md` anchors the waste at `(WASTE_X, TOP_ROW_Y)`,
// `(346, 24)`. Under Draw One "the card the waste shows ... is drawn with its
// top-left at the waste anchor"; under Draw Three the shown cards "are fanned to
// the right from the waste anchor", oldest first, so the oldest of them — the
// bottom-most shown card — is the one at the anchor itself. The anchor is
// therefore the same figure under either deal mode, which is what lets one check
// decide it for both.
//
// THE POSE, AND WHY IT IS ONE CARD. A waste holding one card, with one set of one
// card, so exactly one card is shown whatever the deal mode is and that card is
// both the bottom-most and the top-most of the set. Posing three cards would fan
// under Draw Three and square under Draw One, which would make this check read a
// different picture in each variant; posing a set of three under Draw One would
// pose a state the deal mode never reaches. One card is the state the two modes
// share, and the fan itself is `draw-three/waste-fans-shown-set`.
//
// Every other pile is empty, so the twelve of them draw the card-sized mark
// `specs/table.md` gives an empty pile at its own anchor.
//
// WHAT IS READ, IN TWO DIRECTIONS THAT FAIL DIFFERENTLY.
//
//   1. A card-sized shape sits at `(346, 24)`. The waste holds a card and its set
//      memory is not empty, so it shows one — a waste whose memory is empty draws
//      the mark instead, which is a different state and not the one posed here.
//   2. No card-sized shape sits away from all thirteen anchors, which is the
//      other half of it: a build that kept drawing a mark at the waste's anchor
//      while putting the shown card elsewhere satisfies the first direction
//      alone, and the card it drew is then a shape at no pile's anchor.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertGreaterThan } from "../assert";
import {
  COLUMN_X,
  FOUNDATION_X,
  STOCK_X,
  TABLEAU_Y,
  TOP_ROW_Y,
  WASTE_X,
} from "../constants";
import {
  captureStill,
  cards,
  cardFootprints,
  createHarness,
  openTable,
  poseWaste,
  type Harness,
  type Point,
} from "../harness";

/** The one card on the waste. Its value decides nothing about where it is drawn. */
const CARD = "9D";

/** One set holding it, so the waste shows exactly that card under either mode. */
const SETS = [1];

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
 * it, in logical units. The same allowance, applied to the corner; the anchors
 * this tells apart are `122` units across and `156` down, and the fan pitch a
 * Draw Three build would step by is `26`.
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

it("draws the waste's shown card at its anchor and nowhere else", async () => {
  await openTable(h);
  await poseWaste(h, cards(CARD), SETS);

  const calls = await h.frameCalls();
  await captureStill(h, "waste");

  const drawn = cardFootprints(calls, CARD_SIZE_TOLERANCE);
  const anchor = { x: WASTE_X, y: TOP_ROW_Y };

  assertGreaterThan(
    drawn.filter((corner) => sitsOn(corner, anchor)).length,
    0,
    `card-sized shapes drawn at the waste's anchor (${WASTE_X}, ${TOP_ROW_Y}), ` +
      "where the one card this scenario put on the waste is shown; the waste " +
      "holds a card on a set of its own, so nothing there is the mark an empty " +
      "pile draws (specs/table.md)",
  );

  const stray = drawn.filter((corner) =>
    ANCHORS.every((at) => !sitsOn(corner, at)),
  );
  assertDeepEqual(
    stray.map((corner) => [Math.round(corner.x), Math.round(corner.y)]),
    [],
    "the corners of the card-sized shapes drawn away from all thirteen pile " +
      "anchors: the waste is the only pile holding a card and the other twelve " +
      "draw their marks at their own anchors, so a shape anywhere else is the " +
      "waste's shown card off its anchor (specs/table.md)",
  );
});
