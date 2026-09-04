// tableau/build-down-alternating — a column takes the next card down, in the
// other color.
//
// THE RULE. `specs/tableau.md`, the acceptance table: a column "its lowest card
// is face-up, of rank `r` and color `c`" accepts "a run led by a card of rank
// `r - 1` and the color other than `c`". This check decides that row in the
// ACCEPTING direction, which is the direction no refusal check can reach: the
// card is taken, and it is the column's new lowest card afterwards.
//
// THE POSE. Two columns of one card each on an otherwise empty table. The target
// holds the eight of hearts, red and of rank 8; the source holds the seven of
// spades, black and of rank 7, which is exactly the card the row admits. Nothing
// else on the table can decide where the seven ends up, and the reading is
// `whereIs`, which names the pile it actually landed in: a build that refused it
// leaves it in its own column, and a build that filed it somewhere else is named
// rather than merely counted.
//
// THE SOURCE IS A COLUMN OF ONE, so the run offered is a run of one and nothing
// about multi-card runs is being asked here. Those are the `runs` group's, and
// `tableau/flip-after-run-move` is the only point in this group that moves more
// than one card.
//
// The four faculty gates are left at their reset defaults, which are all on.
// None can fire: the source column is emptied rather than left with a face-down
// card lowest, so `autoFlip` has nothing to turn, and no card goes home, so
// `winDetect` has nothing to declare.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import {
  captureStill,
  card,
  createHarness,
  openTable,
  pileOf,
  poseColumn,
  whereIs,
  type Harness,
} from "../harness";

/** The column the card is offered to, and the card it shows. */
const TARGET = 0;
const TARGET_CARD = card("8H");

/** The column the card is offered from, and the card it holds. */
const SOURCE = 1;
/** One rank below the target's card and the other color: what the row admits. */
const SOURCE_CARD = card("7S");

/** Where the offered card sits in its column, counted from the bottom. */
const SOURCE_ROW = 0;

/**
 * One frame, so the still shows the board the move left.
 *
 * It decides nothing: Klondike moves only when it is moved, and this frame
 * changes no field the assertions read.
 */
const DRAW_FRAMES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("takes a card one rank lower and the other color onto a column", async () => {
  await openTable(h);
  const [targetId] = await poseColumn(h, TARGET, [TARGET_CARD]);
  const [movedId] = await poseColumn(h, SOURCE, [SOURCE_CARD]);

  const accepted = await h.debug.move(
    "tableau",
    SOURCE,
    SOURCE_ROW,
    "tableau",
    TARGET,
  );

  await h.advance(DRAW_FRAMES);
  await captureStill(h, "accepted");
  const after = await h.snapshot();

  assertEqual(
    accepted,
    true,
    `move's verdict on the ${SOURCE_CARD.suit} 7 offered to a column showing ` +
      `the ${TARGET_CARD.suit} 8 — specs/tableau.md: a column whose lowest ` +
      "card is face-up, of rank r and color c, accepts a run led by a card of " +
      "rank r - 1 and the other color",
  );
  assertDeepEqual(
    whereIs(after, movedId),
    { pile: "tableau", index: TARGET, row: 1 },
    `where the ${SOURCE_CARD.suit} 7 (id ${movedId}) sits after the move — it ` +
      "is the target column's new lowest card, drawn below the 8. A reading " +
      "naming column " +
      `${SOURCE} is a build that refused it`,
  );
  assertDeepEqual(
    whereIs(after, targetId),
    { pile: "tableau", index: TARGET, row: 0 },
    `where the ${TARGET_CARD.suit} 8 (id ${targetId}) sits after the move — ` +
      "the card the run landed on stays above it",
  );
  assertLength(
    pileOf(after, "tableau", TARGET),
    2,
    `the cards in column ${TARGET} after the move`,
  );
  assertLength(
    pileOf(after, "tableau", SOURCE),
    0,
    `the cards left in column ${SOURCE}, which held nothing but the 7`,
  );
});
