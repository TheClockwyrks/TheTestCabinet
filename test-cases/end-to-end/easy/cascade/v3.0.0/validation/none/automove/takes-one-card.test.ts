// automove/takes-one-card — the auto-move takes exactly one card; the cards
// above it in the column stay where they are.
//
// `specs/instrumentation.md`: autoMove "sends the named pile's playable card to
// the foundation it belongs on", and the playable card is "a column's lowest
// face-up card" — one card, not the run a press would lift.
// `specs/foundations.md` says the same from the other side: "A foundation takes
// exactly one card at a time. A run of two or more cards is refused, even when
// its leading card alone would be accepted."
//
// THE POSE DISTINGUISHES THE WRONG MODEL. The column is a proper descending
// run of three face-up cards, which is exactly what a press on its highest card
// would lift as one (`specs/tableau.md`). So a build that reused the grab rule
// for the auto-move has three cards in hand rather than one, and the column it
// leaves behind reads as a different length rather than as the same board.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import {
  card,
  captureStill,
  createHarness,
  lowestFaceUp,
  openTable,
  pileOf,
  poseColumn,
  poseFoundation,
  runDown,
  whereIs,
  type Harness,
} from "../harness";

/** The hearts foundation, holding the Ace alone. */
const HEARTS_FOUNDATION = 3;

/** The column: the four of hearts, the three of spades, the two of hearts. */
const COLUMN = 1;
const RUN_TOP = "4H";
const RUN_LENGTH = 3;

/** What the column keeps: every card but the lowest one. */
const KEPT = [
  ["hearts", 4],
  ["spades", 3],
];

/** One frame, so the canvas carries the board the assertions read. */
const SETTLE_FRAMES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sends only the column's lowest card and leaves the rest of the run", async () => {
  await openTable(h);
  await poseFoundation(h, HEARTS_FOUNDATION, "hearts", 1);
  const laid = await poseColumn(h, COLUMN, runDown(card(RUN_TOP), RUN_LENGTH));
  const sentId = laid[laid.length - 1];

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
    { pile: "foundation", index: HEARTS_FOUNDATION, row: 1 },
    "where the one card sent ended up",
  );
  assertLength(
    pileOf(after, "foundation", HEARTS_FOUNDATION),
    2,
    "the cards the hearts foundation holds after the auto-move",
  );

  // The two cards above it are still in the column, in order and face-up.
  assertDeepEqual(
    pileOf(after, "tableau", COLUMN).map((c) => [c.suit, c.rank]),
    KEPT,
    "the cards the column kept",
  );
  assertDeepEqual(
    pileOf(after, "tableau", COLUMN).map((c) => c.faceUp),
    [true, true],
    "the faces the column kept",
  );
});
