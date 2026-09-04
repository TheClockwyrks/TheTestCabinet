// Cascade — table/foundation-anchors: the four foundations stand at
// `FOUNDATION_X`, and the top-row position between them and the draw piles
// carries nothing.
//
// specs/table.md, The top row: the four foundations are anchored at
// "`(FOUNDATION_X[i], TOP_ROW_Y)`" — `(590, 24)`, `(712, 24)`, `(834, 24)`,
// `(956, 24)` — and "The third column position, `x = 468`, carries no pile in
// the top row. It is the space that separates the two draw piles on the left
// from the foundations on the right."
//
// BOTH HALVES ARE READ. Four boxes at four anchors says the foundations are
// spaced at the column pitch and start where the specification puts them; the
// empty position says the row has four foundations rather than five, and that
// the build did not slide the whole row one place left. A build that started its
// foundations at `468` fails both readings, and each names its own half.
//
// What the empty position is read for is a card's CORNER, not the felt beneath
// it: `468` is where a fifth top-row pile would be anchored. Under Draw Three
// the right end of the waste's fan reaches over some of that space
// (specs/table.md), and it is drawn from `398`, so it is not a corner at `468`
// and this reading is the same one in both of the case's deal modes. No card is
// posed on the waste here in any event.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { COLUMN_X, FOUNDATION_X, TOP_ROW_Y } from "../constants";
import {
  ACE,
  ALL_SUITS,
  captureStill,
  card,
  createHarness,
  FOUNDATIONS,
  openTable,
  poseCard,
  type Harness,
} from "../harness";
import { boxesAt, cardBoxes, corners } from "./placed";

/**
 * How far a drawn box's size may sit from `100 x 140`, as a fraction of each
 * side, and still be READ as a card.
 *
 * This is identification and not a requirement: it is how a check picks the
 * cards out of a frame that also drew pips, ranks, the felt and the HUD strip,
 * and it is deliberately loose so that the ONE point about the footprint is the
 * one that decides it. A build that drew every card a few units small has its
 * geometry read here exactly like any other and is charged once, by `card-size`.
 * A fifth of each side is far wider than a defect of that kind and far narrower
 * than anything else this game puts on the table.
 */
const CARD_LIKE_TOLERANCE = 0.2;

/**
 * How far a drawn card's top-left may sit from the anchor it belongs to, in
 * logical units. The anchors are whole numbers in a space that maps one-to-one
 * onto the canvas here, so a conformant build lands on them exactly, and the
 * nearest neighbouring anchor is a column pitch — `122` units — away.
 */
const ANCHOR_TOLERANCE = 1;

/** The top-row position that carries no pile (specs/table.md). */
const EMPTY_TOP_ROW_X = COLUMN_X[2];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws a card on each foundation at that foundation's anchor", async () => {
  openTable(h);
  FOUNDATIONS.forEach((index) =>
    poseCard(h, "foundation", index, card(ALL_SUITS[index], ACE)),
  );

  const calls = await h.drawFrame();
  captureStill(h, "foundations");
  const boxes = cardBoxes(h, calls, CARD_LIKE_TOLERANCE);

  for (const index of FOUNDATIONS) {
    assertGreaterThan(
      boxesAt(boxes, FOUNDATION_X[index], TOP_ROW_Y, ANCHOR_TOLERANCE).length,
      0,
      `the card on foundation ${index} drawn with its top-left at ` +
        `(${FOUNDATION_X[index]}, ${TOP_ROW_Y}); the frame drew card-sized ` +
        `boxes at ${corners(boxes)}`,
    );
  }
});

it("draws nothing card-sized at the empty top-row position", async () => {
  openTable(h);
  FOUNDATIONS.forEach((index) =>
    poseCard(h, "foundation", index, card(ALL_SUITS[index], ACE)),
  );

  const calls = await h.drawFrame();
  const boxes = cardBoxes(h, calls, CARD_LIKE_TOLERANCE);

  assertEqual(
    boxesAt(boxes, EMPTY_TOP_ROW_X, TOP_ROW_Y, ANCHOR_TOLERANCE).length,
    0,
    `card-sized boxes drawn with their top-left at (${EMPTY_TOP_ROW_X}, ` +
      `${TOP_ROW_Y}), where the top row carries no pile; the frame drew ` +
      `card-sized boxes at ${corners(boxes)}`,
  );
});
