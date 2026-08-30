// tableau/no-flip-when-face-up — a move that leaves a face-up card lowest turns
// nothing.
//
// THE RULE. `specs/tableau.md`: the turn belongs to a move that "leaves a column
// whose lowest card is face-down", and "A move that leaves a face-up card lowest
// turns nothing". This check decides that condition on the turn, which the two
// turning checks cannot: they both leave a face-down card lowest, so a build
// that turns the exposed card unconditionally passes each of them and fails only
// here.
//
// THE POSE PUTS A FACE-UP CARD WHERE THE TURN WOULD LAND. Column 0 holds the
// nine of hearts and the Ace of spades, both face-up. The Ace leaves for column
// 1's two of hearts, so the nine is the column's newly lowest card and it is
// already face-up. A build that reads "an accepted move turns the source
// column's lowest card" without the face-down condition sets it — that is, TURNS
// IT OVER — and the nine reads face-down; a build that reads the condition
// leaves every face on the table exactly as it was.
//
// EVERY FACE ON THE TABLE IS READ, not just the exposed one, because the rule is
// that the move turns NOTHING: the nine left behind, the Ace that moved, and
// the two of hearts it landed on.
//
// `autoFlip` is left ON at its reset default. That is the point: the faculty is
// live and the rule is what keeps it from firing.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import {
  captureStill,
  card,
  createHarness,
  openTable,
  pileOf,
  poseColumn,
  requireCard,
  type Harness,
} from "../harness";

/** The column the move takes a card off, both of whose cards are face-up. */
const SOURCE = 0;
/** Its cards, first card first: the nine stays, the Ace below it leaves. */
const SOURCE_CARDS = [card("9H"), card("AS")];
/** Where the Ace sits in that column, counted from the bottom. */
const ACE_ROW = SOURCE_CARDS.length - 1;

/** The column the Ace goes to, and the card that accepts it. */
const TARGET = 1;
const TARGET_CARD = card("2H");

/** One frame, so the still shows the column with every face as it was. */
const DRAW_FRAMES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("changes no card's face when the card left lowest is already face-up", async () => {
  await openTable(h);
  const [stayId, aceId] = await poseColumn(h, SOURCE, SOURCE_CARDS);
  const [landedOnId] = await poseColumn(h, TARGET, [TARGET_CARD]);

  const accepted = await h.debug.move(
    "tableau",
    SOURCE,
    ACE_ROW,
    "tableau",
    TARGET,
  );

  await h.advance(DRAW_FRAMES);
  await captureStill(h, "unchanged");
  const after = await h.snapshot();

  assertEqual(
    accepted,
    true,
    `move's verdict on the spades Ace offered to a column showing the ` +
      `${TARGET_CARD.suit} 2 — a legal move by specs/tableau.md, and the ` +
      "move that must turn nothing",
  );
  assertLength(
    pileOf(after, "tableau", SOURCE),
    SOURCE_CARDS.length - 1,
    `the cards left in column ${SOURCE} once the Ace left it`,
  );
  assertEqual(
    requireCard(after, stayId, "the card the move left lowest in its column")
      .faceUp,
    true,
    `the face of the ${SOURCE_CARDS[0].suit} 9 (id ${stayId}), which the move ` +
      "left lowest in its column and which was already face-up — " +
      "specs/tableau.md: a move that leaves a face-up card lowest turns " +
      "nothing. A reading of false is a build that turns the exposed card over " +
      "rather than face-up",
  );
  assertEqual(
    requireCard(after, aceId, "the card that moved").faceUp,
    true,
    `the face of the spades Ace (id ${aceId}) after it landed`,
  );
  assertEqual(
    requireCard(after, landedOnId, "the card the Ace landed on").faceUp,
    true,
    `the face of the ${TARGET_CARD.suit} 2 (id ${landedOnId}), in the column ` +
      "the Ace landed on",
  );
});
