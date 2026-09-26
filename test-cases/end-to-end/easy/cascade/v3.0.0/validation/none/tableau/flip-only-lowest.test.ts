// tableau/flip-only-lowest — the turn reaches one card and stops.
//
// THE RULE. `specs/tableau.md`: when an accepted move leaves a column whose
// lowest card is face-down, that card turns, and "Only that one card turns:
// every face-down card above it in the column stays face-down." This check
// decides the second half of that sentence, which is the half the turning check
// cannot reach: a build that turns the whole column passes
// `tableau/flip-exposed` and fails here, so the two grade apart and a reviewer
// reads which of the two a build got wrong.
//
// TWO FACE-DOWN CARDS ABOVE THE TURNED ONE, NOT ONE. Column 0 is laid as the
// five of clubs, the nine of diamonds and the four of spades, all face-down,
// with the Ace of spades face-up below them. When the Ace leaves, the four is
// the column's lowest card and turns. A build that turns the whole column turns
// all three; a build that turns the exposed card AND THE ONE ABOVE IT — an
// off-by-one on the same loop — turns two and leaves the five alone. The third
// card is what tells those two apart, and both readings are named.
//
// WHAT THIS POINT DOES NOT ASSERT. That the four turned. That is
// `tableau/flip-exposed`, and a build that turns nothing at all is failed there
// and honestly passed here: it did leave the cards above face-down.
//
// The Ace goes to column 1's two of hearts, a move `specs/tableau.md` accepts,
// so the departure rests on no rule outside this file. `autoFlip` is left ON at
// its reset default, because the turn is the faculty the point is about.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import {
  captureStill,
  card,
  createHarness,
  faceDown,
  openTable,
  pileOf,
  poseColumn,
  requireCard,
  type Harness,
} from "../harness";

/** The column the move empties of face-up cards. */
const SOURCE = 0;
/**
 * Its cards, first card first: three face-down cards, then the Ace below them.
 * The four of spades is the one the move exposes; the nine and the five are the
 * two that must not follow it.
 */
const SOURCE_CARDS = [...faceDown("5C", "9D", "4S"), card("AS")];
/** Where the Ace sits in that column, counted from the bottom. */
const ACE_ROW = SOURCE_CARDS.length - 1;

/** The column the Ace goes to, and the card that accepts it. */
const TARGET = 1;
const TARGET_CARD = card("2H");

/** One frame, so the still shows the one turned card. */
const DRAW_FRAMES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("leaves every face-down card above the exposed one face-down", async () => {
  await openTable(h);
  const [fifthId, ninthId] = await poseColumn(h, SOURCE, SOURCE_CARDS);
  await poseColumn(h, TARGET, [TARGET_CARD]);

  const accepted = await h.debug.move(
    "tableau",
    SOURCE,
    ACE_ROW,
    "tableau",
    TARGET,
  );

  await h.advance(DRAW_FRAMES);
  await captureStill(h, "flipped");
  const after = await h.snapshot();

  assertEqual(
    accepted,
    true,
    `move's verdict on the spades Ace offered to a column showing the ` +
      `${TARGET_CARD.suit} 2 — a legal move by specs/tableau.md, and the ` +
      "move whose turn this point bounds",
  );
  assertLength(
    pileOf(after, "tableau", SOURCE),
    SOURCE_CARDS.length - 1,
    `the cards left in column ${SOURCE} once the Ace left it`,
  );
  assertEqual(
    requireCard(after, ninthId, "the card directly above the exposed one")
      .faceUp,
    false,
    `the face of the diamonds 9 (id ${ninthId}), which lies directly above ` +
      "the card the move exposed — specs/tableau.md: only the newly lowest " +
      "card turns. A build that reads this as face-up turned one card too many",
  );
  assertEqual(
    requireCard(
      after,
      fifthId,
      "the column's first card, two above the exposed",
    ).faceUp,
    false,
    `the face of the clubs 5 (id ${fifthId}), the column's first card — a ` +
      "build that reads this as face-up turned the whole column",
  );
});
