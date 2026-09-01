// tableau/flip-exposed — the card a move uncovers turns face-up.
//
// THE RULE. `specs/tableau.md`: "When an accepted move leaves a column whose
// lowest card is face-down, that card is turned face-up." This check decides
// that rule in the direction that matters most — a build that never turns an
// exposed card is a build a player cannot finish a game on, because every column
// stays closed under the card it was dealt with.
//
// THE POSE IS THE SMALLEST ONE THE RULE APPLIES TO. Column 0 holds two cards: a
// face-down seven of diamonds with the Ace of spades face-up below it, the Ace
// being the column's only face-up card and so the only one a move can take. The
// Ace goes to column 1's two of hearts, a move `specs/tableau.md` accepts — one
// rank down, the other color — so the departure is legal on its own terms and
// the check is not resting on any other rule to reach the state it reads. What
// is read is the face of the seven the Ace was covering.
//
// WHY THE MOVE IS A COLUMN-TO-COLUMN MOVE. It keeps the whole scenario inside
// the rules this group owns. Sending the Ace to a foundation would reach the
// same state through `specs/foundations.md`, so a build with a broken foundation
// would fail this point for a reason that has nothing to do with turning a card.
//
// `autoFlip` is left ON, at its reset default, because it is the faculty this
// point is about. `instrumentation/auto-flip-gate` is the point that decides the
// gate; this one decides the turn.

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
/** Its cards, first card first: the buried seven, then the Ace below it. */
const SOURCE_CARDS = [...faceDown("7D"), card("AS")];
/** Where the Ace sits in that column, counted from the bottom. */
const ACE_ROW = SOURCE_CARDS.length - 1;

/** The column the Ace goes to, and the card that accepts it. */
const TARGET = 1;
const TARGET_CARD = card("2H");

/** One frame, so the still shows the turned card. */
const DRAW_FRAMES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("turns the face-down card a move leaves lowest in its column", async () => {
  await openTable(h);
  const [buriedId] = await poseColumn(h, SOURCE, SOURCE_CARDS);
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
      "move that uncovers the card this point reads",
  );
  assertLength(
    pileOf(after, "tableau", SOURCE),
    SOURCE_CARDS.length - 1,
    `the cards left in column ${SOURCE} once the Ace left it`,
  );
  assertEqual(
    requireCard(after, buriedId, "the card the departing Ace uncovered").faceUp,
    true,
    `the face of the ${SOURCE_CARDS[0].suit} 7 (id ${buriedId}) after the ` +
      "move — specs/tableau.md: an accepted move that leaves a column whose " +
      "lowest card is face-down turns that card face-up",
  );
});
