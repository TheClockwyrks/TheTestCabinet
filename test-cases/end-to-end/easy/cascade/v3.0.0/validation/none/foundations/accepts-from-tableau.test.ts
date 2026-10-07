// foundations/accepts-from-tableau — a column's exposed card is a source a
// foundation takes from.
//
// `specs/foundations.md`: "A foundation accepts a card from a tableau column and
// from the waste, on exactly the terms above." This check decides the column
// half of that sentence, and it decides it on a column of more than one card, so
// what goes home is the column's LOWEST face-up card — the one drawn lowest on
// the table (`specs/table.md`), which `specs/instrumentation.md` reports last —
// and the rest of the column stays where it was.
//
// THE COLUMN IS TWO CARDS, THE THREE OF HEARTS WITH THE TWO OF SPADES BELOW IT.
// The two is what the foundation wants; the three above it is what a build that
// reads a column from the wrong end would send instead, and it would be refused
// (a red three onto a spade Ace), so the two models read apart at the verdict as
// well as on the board. The three is also of no use to any foundation here, so
// nothing but the two can legally leave the column.
//
// NOTHING TURNS AND NOTHING ELSE MOVES. The card left lowest is already face-up,
// so `autoFlip` has nothing to do at its reset default, and the other six
// columns, the stock and the waste stay empty. What the check reads is the
// foundation's new top card and the one card the column has left.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import { RANK_MIN } from "../constants";
import {
  captureStill,
  cards,
  createHarness,
  openTable,
  pileOf,
  poseColumn,
  poseFoundation,
  whereIs,
  type Harness,
} from "../harness";

/** The foundation under test, and the suit its Ace locks it to. */
const FOUNDATION = 0;
const SUIT = "spades" as const;

/** The column the card is offered from. */
const COLUMN = 0;

/**
 * The column, in pile order: the three of hearts first, the two of spades below
 * it. The two is the column's exposed card and the only one going anywhere.
 */
const COLUMN_CARDS = cards("3H", "2S");

/** Where the exposed card sits in the column, counted from the bottom. */
const EXPOSED_ROW = COLUMN_CARDS.length - 1;

/** One frame, so the still shows the column's card on its foundation. */
const DRAW_FRAMES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("takes a column's lowest face-up card onto a legal foundation and leaves the rest", async () => {
  await openTable(h);
  await poseFoundation(h, FOUNDATION, SUIT, RANK_MIN);
  const [restId, exposedId] = await poseColumn(h, COLUMN, COLUMN_CARDS);

  const accepted = await h.debug.move(
    "tableau",
    COLUMN,
    EXPOSED_ROW,
    "foundation",
    FOUNDATION,
  );

  await h.advance(DRAW_FRAMES);
  await captureStill(h, "accepted");
  const after = await h.snapshot();

  assertEqual(
    accepted,
    true,
    `move's verdict on column ${COLUMN}'s exposed ${SUIT} 2 offered to a ` +
      `${SUIT} foundation holding its Ace — specs/foundations.md: a ` +
      "foundation accepts a card from a tableau column",
  );
  assertDeepEqual(
    whereIs(after, exposedId),
    { pile: "foundation", index: FOUNDATION, row: 1 },
    `where the ${SUIT} 2 (id ${exposedId}) sits after the move — it is the ` +
      "foundation's new top card",
  );
  assertLength(
    pileOf(after, "foundation", FOUNDATION),
    2,
    `the cards on foundation ${FOUNDATION} after the move`,
  );
  assertDeepEqual(
    whereIs(after, restId),
    { pile: "tableau", index: COLUMN, row: 0 },
    `where the hearts 3 above it (id ${restId}) sits after the move — ` +
      "specs/tableau.md: the cards above the one taken stay in the column",
  );
  assertLength(
    pileOf(after, "tableau", COLUMN),
    COLUMN_CARDS.length - 1,
    `the cards left in column ${COLUMN} after the move`,
  );
});
