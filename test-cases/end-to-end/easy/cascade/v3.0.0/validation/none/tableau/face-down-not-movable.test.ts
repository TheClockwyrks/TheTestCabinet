// tableau/face-down-not-movable — a face-down card is never the source of a move.
//
// THE RULE. `specs/tableau.md`: "A move whose taken card is face-down is
// refused, and the board is left exactly as it was", and "A face-down card is
// never moved and is never read. It becomes playable only once it has been
// turned." This check decides the source side of the face-down rule.
// `tableau/reject-onto-face-down` decides the target side; they are different
// rules and a build can hold one without the other.
//
// THE POSE MAKES THE MOVE LEGAL IN EVERY OTHER RESPECT, so the face is the only
// thing that can decide the verdict. Column 0 is the seven of spades face-down
// with the six of hearts face-up below it, which is an ordered run — one rank
// lower, the other color — and the target column shows the eight of hearts, one
// rank above the seven and the other color. So the run named by row 0 is a run
// `specs/tableau.md` would have that column accept, and a build that never looks
// at the face of the card it takes moves both cards and the column reads empty.
// Only the face-down rule refuses it.
//
// THE WHOLE BOARD IS READ BACK, both cards in place and in order and the target
// still holding its one card, because the rule says the board is left exactly as
// it was rather than merely that the move reported a refusal.
//
// The four faculty gates are left at their reset defaults, which are all on. A
// refused move applies nothing, so none of them has anything to do — and a build
// that turned the seven here would be turning a card no accepted move exposed.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import {
  captureStill,
  card,
  createHarness,
  faceDown,
  openTable,
  pileOf,
  poseColumn,
  requireCard,
  whereIs,
  type Harness,
} from "../harness";

/** The column the move names as its source. */
const SOURCE = 0;
/** Its cards, first card first: the face-down seven, the face-up six below it. */
const SOURCE_CARDS = [...faceDown("7S"), card("6H")];
/** The face-down card the move names, counted from the bottom. */
const FACE_DOWN_ROW = 0;

/** The column the move names as its target, and the card it shows. */
const TARGET = 1;
const TARGET_CARD = card("8H");

/** One frame, so the still shows the board the refused move left. */
const DRAW_FRAMES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("refuses a move whose source card is face-down and leaves the board as it was", async () => {
  await openTable(h);
  const [buriedId, belowId] = await poseColumn(h, SOURCE, SOURCE_CARDS);
  const [targetId] = await poseColumn(h, TARGET, [TARGET_CARD]);

  const accepted = await h.debug.move(
    "tableau",
    SOURCE,
    FACE_DOWN_ROW,
    "tableau",
    TARGET,
  );

  await h.advance(DRAW_FRAMES);
  await captureStill(h, "refused");
  const after = await h.snapshot();

  assertEqual(
    accepted,
    false,
    "move's verdict on a run taken from a FACE-DOWN seven of spades, offered " +
      `to a column showing the ${TARGET_CARD.suit} 8 — specs/tableau.md: a ` +
      "move whose taken card is face-down is refused, however well the cards " +
      "would otherwise fit",
  );
  assertLength(
    pileOf(after, "tableau", SOURCE),
    SOURCE_CARDS.length,
    `the cards in column ${SOURCE} after the refusal — anything less is a ` +
      "build that moved a card it is never allowed to read",
  );
  assertDeepEqual(
    whereIs(after, buriedId),
    { pile: "tableau", index: SOURCE, row: 0 },
    `where the face-down 7 (id ${buriedId}) sits after the refusal — ` +
      "specs/tableau.md: the board is left exactly as it was",
  );
  assertDeepEqual(
    whereIs(after, belowId),
    { pile: "tableau", index: SOURCE, row: 1 },
    `where the ${SOURCE_CARDS[1].suit} 6 (id ${belowId}) below it sits after ` +
      "the refusal",
  );
  assertEqual(
    requireCard(after, buriedId, "the face-down card the move named").faceUp,
    false,
    `the face of the 7 (id ${buriedId}) after the refusal — a refused move ` +
      "turns nothing",
  );
  assertLength(
    pileOf(after, "tableau", TARGET),
    1,
    `the cards in column ${TARGET} after the refusal, which held only the 8`,
  );
  assertDeepEqual(
    whereIs(after, targetId),
    { pile: "tableau", index: TARGET, row: 0 },
    `where the ${TARGET_CARD.suit} 8 (id ${targetId}) sits after the refusal`,
  );
});
