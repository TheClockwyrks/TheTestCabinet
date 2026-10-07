// automove/column-goes-home — `autoMove("tableau", c)` sends a column's lowest
// face-up card to the foundation it belongs on, and answers `true`.
//
// `specs/instrumentation.md`: "The playable card is the waste's top card, or a
// column's lowest face-up card ... It returns `true` when the card went home".
// `specs/foundations.md` fixes the destination: the foundation "already holding
// the next-lower card of its own suit".
//
// ONE CARD, ONE COLUMN, ONE FOUNDATION. The column holds exactly the card the
// requirement is about, so nothing else on the table can absorb a wrong answer,
// and the column is left empty, which turns nothing — the turning of an exposed
// card is `automove/flips-exposed`, and how many cards leave is
// `automove/takes-one-card`.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import {
  cards,
  captureStill,
  createHarness,
  lowestFaceUp,
  openTable,
  pileOf,
  poseColumn,
  poseFoundation,
  whereIs,
  type Harness,
} from "../harness";

/** The column the card is sent from. Not column `0`, so a hard-coded one fails. */
const COLUMN = 3;

/**
 * The foundation the spades stand on, holding the Ace alone.
 *
 * Foundation `1` rather than `0`: `specs/foundations.md` ties no suit to a slot,
 * so a build that picked a foundation by a fixed suit order would send the two
 * of spades to a foundation that is not the one holding spades, and fail here as
 * it should.
 */
const SPADES_FOUNDATION = 1;

/** The card sent: rank `r + 1` of the spades foundation's top card, the Ace. */
const SENT = "2S";

/** One frame, so the canvas carries the board the assertions read. */
const SETTLE_FRAMES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sends a column's lowest face-up card home and says so", async () => {
  await openTable(h);
  await poseFoundation(h, SPADES_FOUNDATION, "spades", 1);
  const [sentId] = await poseColumn(h, COLUMN, cards(SENT));

  assertEqual(
    lowestFaceUp(await h.snapshot(), COLUMN)?.id,
    sentId,
    "the column's playable card before the auto-move",
  );

  const went = await h.debug.autoMove("tableau", COLUMN);
  await h.advance(SETTLE_FRAMES);
  await captureStill(h, "home");

  assertEqual(went, true, "the verdict autoMove returned");

  const after = await h.snapshot();
  assertDeepEqual(
    whereIs(after, sentId),
    { pile: "foundation", index: SPADES_FOUNDATION, row: 1 },
    "where the column's card ended up",
  );
  assertDeepEqual(
    pileOf(after, "foundation", SPADES_FOUNDATION).map((c) => [c.suit, c.rank]),
    [
      ["spades", 1],
      ["spades", 2],
    ],
    "the spades foundation after the auto-move",
  );
  assertLength(
    pileOf(after, "tableau", COLUMN),
    0,
    "the cards left in the column",
  );
});
