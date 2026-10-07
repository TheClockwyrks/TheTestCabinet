// tableau/flip-after-run-move — a departing RUN uncovers a card and it turns.
//
// THE RULE. `specs/tableau.md`: "When an accepted move leaves a column whose
// lowest card is face-down, that card is turned face-up." The rule is written
// over the move rather than over the number of cards it took, so a three-card
// run leaving a column turns what it uncovers exactly as a single card does.
//
// WHY THIS IS ITS OWN POINT AND NOT `tableau/flip-exposed` AGAIN. The turn is
// bookkeeping the accepted move owes, and a build that hangs it on the
// single-card path — a `move one card` function that turns, with the run path
// beside it that does not — passes `flip-exposed` and fails here. That is a real
// build shape and a real player-visible defect: a column emptied by a run stays
// closed for the rest of the game. Three cards is the smallest run that is not
// a pair, so a build whose run path handles two cards and no more is also caught.
//
// THE POSE. Column 0 is the two of clubs face-down with the eight of hearts, the
// seven of spades and the six of hearts face-up below it, which is an ordered run
// by `specs/tableau.md` — each card one rank lower and the other color than the
// one above it. It goes to column 1's nine of spades, one rank above the run's
// leading eight and the other color, so the column accepts it. The run's
// departure is `runs/moves-as-unit`'s point; what is read here is the face of the
// two the run was covering.
//
// `autoFlip` is left ON at its reset default, because the turn is the faculty
// the point is about.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import {
  captureStill,
  card,
  cards,
  createHarness,
  faceDown,
  openTable,
  pileOf,
  poseColumn,
  requireCard,
  type Harness,
} from "../harness";

/** The column the run leaves. */
const SOURCE = 0;
/** The ordered run, first card first, and the card it is covering. */
const RUN = cards("8H", "7S", "6H");
const SOURCE_CARDS = [...faceDown("2C"), ...RUN];
/** Where the run's leading card sits in that column, counted from the bottom. */
const RUN_ROW = SOURCE_CARDS.length - RUN.length;

/** The column the run goes to, and the card that accepts it. */
const TARGET = 1;
const TARGET_CARD = card("9S");

/** One frame, so the still shows the card the run uncovered. */
const DRAW_FRAMES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("turns the card a three-card run uncovers as it leaves the column", async () => {
  await openTable(h);
  const [buriedId] = await poseColumn(h, SOURCE, SOURCE_CARDS);
  await poseColumn(h, TARGET, [TARGET_CARD]);

  const accepted = await h.debug.move(
    "tableau",
    SOURCE,
    RUN_ROW,
    "tableau",
    TARGET,
  );

  await h.advance(DRAW_FRAMES);
  await captureStill(h, "flipped");
  const after = await h.snapshot();

  assertEqual(
    accepted,
    true,
    `move's verdict on the three-card run led by the ${RUN[0].suit} 8, ` +
      `offered to a column showing the ${TARGET_CARD.suit} 9 — a legal move ` +
      "by specs/tableau.md, and the move that uncovers the card this point " +
      "reads",
  );
  assertLength(
    pileOf(after, "tableau", SOURCE),
    SOURCE_CARDS.length - RUN.length,
    `the cards left in column ${SOURCE} once the run left it — anything but ` +
      "one is a build whose run took the wrong cards, which runs/ grades",
  );
  assertEqual(
    requireCard(after, buriedId, "the card the departing run uncovered").faceUp,
    true,
    `the face of the clubs 2 (id ${buriedId}) after the run left — ` +
      "specs/tableau.md: an accepted move that leaves a column whose lowest " +
      "card is face-down turns that card, however many cards the move took",
  );
});
