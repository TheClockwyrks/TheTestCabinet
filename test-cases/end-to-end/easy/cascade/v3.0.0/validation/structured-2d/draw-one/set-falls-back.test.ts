// draw-one/set-falls-back — a set played off entirely leaves the waste showing
// what the turn before it left.
//
// THE RULE. specs/stock.md gives the waste a set memory: each turn appends one
// set holding exactly the cards it moved, the waste shows the cards it holds
// from the newest set that still holds any, and "a set played off entirely
// leaves the memory, so the waste falls back to what is left of the set turned
// before it". In Draw One a turn is a set of one, so playing the shown card off
// empties its set and the card the previous turn left is what the waste shows
// again.
//
// THIS IS THE STATE THE OLD SPECIFICATION LEFT UNDER-DETERMINED. A build is free
// to hold the waste as a plain stack and report a count, and such a build shows
// nothing at all here, or keeps showing the card that has already gone home.
// Both are legible faults and both fail this point.
//
// THE POINT READS THE FALLBACK BY IDENTITY AS WELL AS BY COUNT, because a build
// that remembers only how many cards its last turn moved reports `1` here for
// the wrong reason: the count alone cannot tell a fallback apart from a counter
// that was never emptied. The card the earlier turn left carries an id from the
// moment it was posed (specs/instrumentation.md), so the reading names it.
//
// THE POSE IS TWO CARDS AND NO FOUNDATION. The card the second turn moves is an
// Ace, which an empty foundation accepts from the waste (specs/foundations.md),
// so the scenario needs no foundation built up under it and no card on the table
// beyond the two the two turns move.
//
// WHAT IT DOES NOT DECIDE. That a turn appends a set at all is
// `stock/turn-starts-a-set`, that playing the top card shrinks its set is
// `stock/set-shrinks-on-play`, and that a recycle empties the memory is
// `stock/recycle-clears-sets`.

import { afterEach, beforeEach, it } from "vitest";
import { TURN_COUNT } from "../../src/constants";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  ACE,
  SEVEN,
  captureStill,
  card,
  createHarness,
  openTable,
  poseStock,
  topOf,
  type Harness,
} from "../harness";

/** The card the FIRST turn moves, which the waste must fall back to. */
const EARLIER = card("hearts", SEVEN);

/** The card the SECOND turn moves, which is played home. */
const NEWER = card("spades", ACE);

/**
 * The stock the two turns are taken from, bottom card first.
 *
 * A turn takes from the top of the stock (specs/stock.md), so the last card here
 * is the one the first turn moves and the first is the one the second turn
 * moves. The second turn's card is the Ace, so it is the one that can be played
 * home onto an empty foundation.
 */
const STOCK = [NEWER, EARLIER];

/** The empty foundation the Ace is sent to. Any suit may start any slot. */
const FOUNDATION = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("shows the earlier turn's card once the newer one is played home", async () => {
  openTable(h);
  const [, earlier] = poseStock(h, STOCK);

  h.debug.turnStock();
  h.debug.turnStock();

  // The waste's top card is the only one that may be played (specs/stock.md),
  // and its row is read off the waste the build actually built rather than
  // assumed, so what this move names is that top card whatever the turns put
  // there.
  const turned = h.snapshot();
  const played = h.debug.move(
    "waste",
    0,
    turned.waste.length - 1,
    "foundation",
    FOUNDATION,
  );
  const after = h.snapshot();

  await h.advance(1);
  captureStill(h, "waste");

  assertEqual(
    played,
    true,
    `move() to accept the ${NEWER.suit} Ace, the waste's top card, onto empty ` +
      `foundation ${FOUNDATION}: a foundation holding nothing accepts an Ace ` +
      "of any suit (specs/foundations.md)",
  );
  assertEqual(
    after.wasteVisibleCount,
    TURN_COUNT,
    "cards the waste shows once its newest set has been played off entirely: " +
      "the memory falls back to the set turned before it, which holds one " +
      "card (specs/stock.md)",
  );

  // Identity as well as count: a build that merely kept a counter alive reports
  // the right number over the wrong card, and the id the pose handed back is
  // what separates the two (specs/instrumentation.md).
  const shown = topOf(after.waste);
  assertDeepEqual(
    shown === undefined
      ? null
      : { suit: shown.suit, rank: shown.rank, id: shown.id },
    { suit: EARLIER.suit, rank: EARLIER.rank, id: earlier },
    "the card the waste shows once the newer set has been played off, which " +
      `is the ${EARLIER.suit} ${EARLIER.rank} the earlier turn left ` +
      "(specs/stock.md)",
  );
});
