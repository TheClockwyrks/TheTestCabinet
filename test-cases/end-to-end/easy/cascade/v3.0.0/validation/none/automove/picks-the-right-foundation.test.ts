// automove/picks-the-right-foundation — with three foundations started, the card
// joins the one already holding its own suit.
//
// `specs/foundations.md`: "A card belongs on the foundation that would accept it:
// the one already holding the next-lower card of its own suit", and "Once a
// foundation holds a card it is locked to that card's suit".
//
// THE POSE IS BUILT SO EVERY WRONG MODEL READS AS A DIFFERENT SLOT. The three
// started foundations carry diamonds, clubs and spades, in that order, and the
// fourth is empty:
//
//   the foundation holding the card's suit   -> 2, the answer
//   a fixed slot in the deck's suit order    -> 0, since spades lead `SUITS`
//   the first foundation, or the first that
//     holds anything                         -> 0
//   the first EMPTY foundation               -> 3
//
// so a failure names which foundation the build reached for. The spades stand at
// rank four and the card offered is the five, so only the rank rule and the suit
// rule together pick slot `2`.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import {
  cards,
  captureStill,
  createHarness,
  openTable,
  pileOf,
  poseColumn,
  poseFoundation,
  topOf,
  whereIs,
  type Harness,
} from "../harness";

/**
 * The three started foundations, in slot order, and how far up each stands.
 *
 * Deliberately NOT the order `specs/deal.md` lists the suits in: spades lead the
 * deck and stand on slot `2` here.
 */
const STARTED = [
  { index: 0, suit: "diamonds" as const },
  { index: 1, suit: "clubs" as const },
  { index: 2, suit: "spades" as const },
];
const STARTED_UP_TO = 4;

/** The slot the card's own suit stands on, which is the answer. */
const OWN_SUIT_FOUNDATION = 2;

/** The slot left empty, so "the first empty one" is a distinguishable answer. */
const EMPTY_FOUNDATION = 3;

/** The column the card is sent from, and the card: rank `4 + 1` of spades. */
const COLUMN = 5;
const SENT = "5S";

/** One frame, so the canvas carries the board the assertions read. */
const SETTLE_FRAMES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("joins the card to the foundation already holding its suit", async () => {
  await openTable(h);
  for (const { index, suit } of STARTED) {
    await poseFoundation(h, index, suit, STARTED_UP_TO);
  }
  const [sentId] = await poseColumn(h, COLUMN, cards(SENT));

  const went = await h.debug.autoMove("tableau", COLUMN);
  await h.advance(SETTLE_FRAMES);
  await captureStill(h, "home");

  assertEqual(went, true, "the verdict autoMove returned");

  const after = await h.snapshot();
  assertDeepEqual(
    whereIs(after, sentId),
    { pile: "foundation", index: OWN_SUIT_FOUNDATION, row: STARTED_UP_TO },
    "the foundation the five of spades joined",
  );
  assertEqual(
    topOf(pileOf(after, "foundation", OWN_SUIT_FOUNDATION))?.rank,
    5,
    "the rank the spades foundation now shows",
  );

  // The two other started foundations kept exactly what they held, and the empty
  // one is still empty.
  for (const { index } of STARTED) {
    if (index === OWN_SUIT_FOUNDATION) continue;
    assertLength(
      pileOf(after, "foundation", index),
      STARTED_UP_TO,
      `the cards on foundation ${index} after the auto-move`,
    );
  }
  assertLength(
    pileOf(after, "foundation", EMPTY_FOUNDATION),
    0,
    "the cards on the foundation that was left empty",
  );
});
