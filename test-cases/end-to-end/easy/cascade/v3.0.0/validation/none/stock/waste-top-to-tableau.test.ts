// stock/waste-top-to-tableau — the waste's top card can be played onto a column
// that accepts it, and it LEAVES the waste when it goes.
//
// `specs/stock.md`: "Only the waste's top card may be played, onto a foundation
// that accepts it by `specs/foundations.md` or onto a column that accepts it by
// `specs/tableau.md`." This is the acceptance direction of that sentence for a
// column; the foundation half is `stock.waste-top-to-foundation`.
//
// THE COLUMN TAKES IT ON THE ORDINARY TERMS. `specs/tableau.md`: a column whose
// lowest card is face-up "of rank `r` and colour `c`" accepts "a run led by a
// card of rank `r - 1` and the colour other than `c`", and "A column accepts a
// run from another column, from the waste, and from a foundation, on exactly the
// terms above." The seven of spades is black, so the six of hearts fits.
//
// THE CARD THAT GOES IS THE TOP ONE, and the waste holds a second card so that
// is a choice. The buried card is the three of clubs: black, and three ranks
// below the column's card, so the column refuses it. A build that reached past
// the waste's top card reads as a refused move.
//
// THE READING IS BOTH PILES: the six of hearts drawn lowest in the column, and
// the waste left holding only the card that was behind it.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import {
  captureStill,
  cards,
  createHarness,
  openTable,
  pileOf,
  poseColumn,
  poseWaste,
  topOf,
  whereIs,
  type Harness,
} from "../harness";
import { turnCount, turnSets } from "./turns";

/** The column that takes the card, showing a black seven as its lowest card. */
const COLUMN = 3;
const COLUMN_CARDS = ["7S"];

/** The waste, bottom card first: a card the column refuses, then the one it takes. */
const WASTE = ["3C", "6H"];
const TOP_ROW = WASTE.length - 1;

/** One frame, so the still carries the waste's card on the column. */
const DRAW_FRAMES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("plays the waste's top card onto a column that accepts it", async () => {
  await openTable(h);
  const count = turnCount(await h.snapshot());
  await poseColumn(h, COLUMN, cards(...COLUMN_CARDS));
  const [buriedId, topId] = await poseWaste(
    h,
    cards(...WASTE),
    turnSets(WASTE.length, count),
  );

  const played = await h.debug.move("waste", 0, TOP_ROW, "tableau", COLUMN);
  await h.advance(DRAW_FRAMES);
  await captureStill(h, "accepted");

  assertEqual(
    played,
    true,
    `move's verdict on the waste's ${WASTE[TOP_ROW]} offered to a column ` +
      `whose lowest card is the ${COLUMN_CARDS[0]} — specs/stock.md lets the ` +
      "waste's top card be played onto a column that accepts it, and " +
      "specs/tableau.md accepts a card one rank lower of the other colour",
  );

  const after = await h.snapshot();
  assertDeepEqual(
    whereIs(after, topId),
    { pile: "tableau", index: COLUMN, row: COLUMN_CARDS.length },
    `where the ${WASTE[TOP_ROW]} (id ${topId}) sits after the move — it is ` +
      `column ${COLUMN}'s new lowest card`,
  );
  assertLength(
    pileOf(after, "tableau", COLUMN),
    COLUMN_CARDS.length + 1,
    `the cards in column ${COLUMN} after the move`,
  );
  assertLength(
    after.waste,
    WASTE.length - 1,
    "the cards left on the waste — the card landed on the column, so it " +
      "left the waste rather than being copied off it",
  );
  assertEqual(
    topOf(after.waste)?.id,
    buriedId,
    `the card the waste is left holding, which is the ${WASTE[0]} that was ` +
      "behind the one that went",
  );
});
