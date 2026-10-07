// foundations/pull-back-to-tableau — a card that went home can come back.
//
// `specs/foundations.md`, "Leaving a foundation": "A foundation's top card may
// be moved back onto a tableau column that accepts it by the rules in
// `specs/tableau.md`. The card leaves the foundation, and the card beneath it
// becomes that foundation's top card."
//
// THE COLUMN IS POSED TO ACCEPT THE CARD AND NOTHING ELSE. The foundation is
// built to the five of spades, and the column holds a single six of hearts,
// which `specs/tableau.md` makes a column that accepts "a run led by a card of
// rank `r - 1` and the color other than" its lowest card's — a black five, which
// is exactly what the foundation is offering. So the target's own rule is
// satisfied and the only thing the check can be deciding is whether a foundation
// will let its top card go.
//
// WHAT EACH WRONG MODEL LEAVES. A build whose foundations are one-way reads a
// refusal, five cards still home and one card in the column. A build that lets
// the card go without taking it off the foundation reads two cards in the column
// and five still home. A build that empties the whole foundation reads two in
// the column and none home. Only the stated rule reads two in the column and
// four home, with the four of spades on top.
//
// THE GRAB NAMES THE FOUNDATION'S TOP CARD, at row `BUILT_TO - 1` counting from
// the bottom, because `specs/instrumentation.md` orders a pile bottom to top and
// a foundation is squared, so that row takes that card alone.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import {
  captureStill,
  card,
  createHarness,
  openTable,
  pileOf,
  poseColumn,
  poseFoundation,
  topOf,
  whereIs,
  type Harness,
} from "../harness";

/** The foundation under test, and the suit it is locked to. */
const FOUNDATION = 0;
const SUIT = "spades" as const;

/** How high the foundation is built: the Ace through the five of spades. */
const BUILT_TO = 5;

/** Where the foundation's top card sits, counted from the bottom. */
const TOP_ROW = BUILT_TO - 1;

/** The column the card is pulled back onto. */
const COLUMN = 0;

/**
 * The column's only card: a red six, one rank above the black five the
 * foundation is holding, which is what `specs/tableau.md` requires of a column
 * that accepts it.
 */
const COLUMN_CARD = card("6H");

/** One frame, so the still shows the card back on the column. */
const DRAW_FRAMES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("moves a foundation's top card back onto a column that accepts it", async () => {
  await openTable(h);
  const homeIds = await poseFoundation(h, FOUNDATION, SUIT, BUILT_TO);
  const pulledId = homeIds[TOP_ROW];
  await poseColumn(h, COLUMN, [COLUMN_CARD]);

  const accepted = await h.debug.move(
    "foundation",
    FOUNDATION,
    TOP_ROW,
    "tableau",
    COLUMN,
  );

  await h.advance(DRAW_FRAMES);
  await captureStill(h, "pulled");
  const after = await h.snapshot();

  assertEqual(
    accepted,
    true,
    `move's verdict on foundation ${FOUNDATION}'s top card, the ${SUIT} ` +
      `${BUILT_TO}, offered to a column holding the hearts ${COLUMN_CARD.rank}` +
      " — specs/foundations.md lets a foundation's top card be moved back " +
      "onto a tableau column that accepts it",
  );
  assertDeepEqual(
    whereIs(after, pulledId),
    { pile: "tableau", index: COLUMN, row: 1 },
    `where the ${SUIT} ${BUILT_TO} (id ${pulledId}) sits after the move — it ` +
      "is the column's new lowest card, beneath the six it landed on",
  );
  assertLength(
    pileOf(after, "foundation", FOUNDATION),
    BUILT_TO - 1,
    `the cards left on foundation ${FOUNDATION} — ${BUILT_TO} is a build that ` +
      "landed the card without taking it off the foundation, 0 one that " +
      "emptied the whole pile",
  );
  assertEqual(
    topOf(pileOf(after, "foundation", FOUNDATION))?.rank,
    BUILT_TO - 1,
    `the rank of foundation ${FOUNDATION}'s top card after the pull-back — ` +
      "specs/foundations.md: the card beneath the one that left becomes the " +
      "foundation's top card",
  );
  assertLength(
    pileOf(after, "tableau", COLUMN),
    2,
    `the cards in column ${COLUMN} after the pull-back`,
  );
});
