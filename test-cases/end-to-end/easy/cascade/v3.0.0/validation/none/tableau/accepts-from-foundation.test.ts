// tableau/accepts-from-foundation — a foundation is a source a column takes from.
//
// THE RULE. `specs/tableau.md`: "A column accepts a run from another column,
// from the waste, and from a foundation, on exactly the terms above." This check
// decides the foundation half of that sentence — the pull-back, the move a
// player makes to free a card the tableau needs. `specs/foundations.md` states
// the same move from the other side, and `foundations/pull-back-to-tableau` is
// the point that grades the card LEAVING the foundation; this one grades the
// column TAKING it.
//
// THE POSE IS THE SMALLEST FOUNDATION THE MOVE IS INTERESTING ON. Foundation 0
// is built up in spades to the three, so the three is its top card and the two
// is under it: a build that pulls the wrong card off a foundation offers the Ace
// or the two, and the column showing the four of hearts refuses both, so the
// verdict and `whereIs` name it rather than the check passing by luck on a
// one-card pile.
//
// The three of spades is one rank below the four of hearts and the other color,
// so `specs/tableau.md` accepts it. What is read is the three on the column and
// the two now on top of the foundation.
//
// The four faculty gates are left at their reset defaults, which are all on.
// The source is a foundation rather than a column, so `autoFlip` has nothing to
// turn, and a foundation losing a card cannot win the game.

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

/** The column the foundation's card is offered to, and the card it shows. */
const TARGET = 0;
const TARGET_CARD = card("4H");

/** The foundation the card is pulled back from, its suit, and how far it is built. */
const FOUNDATION = 0;
const SUIT = "spades" as const;
const BUILT_TO = 3;

/** Where the foundation's top card sits in the pile, counted from the bottom. */
const FOUNDATION_TOP_ROW = BUILT_TO - 1;

/** One frame, so the still shows the foundation's card back on a column. */
const DRAW_FRAMES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("takes a card pulled back off a foundation onto a legal column", async () => {
  await openTable(h);
  const [, twoId, threeId] = await poseFoundation(
    h,
    FOUNDATION,
    SUIT,
    BUILT_TO,
  );
  const [targetId] = await poseColumn(h, TARGET, [TARGET_CARD]);

  const accepted = await h.debug.move(
    "foundation",
    FOUNDATION,
    FOUNDATION_TOP_ROW,
    "tableau",
    TARGET,
  );

  await h.advance(DRAW_FRAMES);
  await captureStill(h, "accepted");
  const after = await h.snapshot();

  assertEqual(
    accepted,
    true,
    `move's verdict on the ${SUIT} 3, the foundation's top card, offered to a ` +
      `column showing the ${TARGET_CARD.suit} 4 — specs/tableau.md: a column ` +
      "accepts a run from a foundation on the same terms as one from a column",
  );
  assertDeepEqual(
    whereIs(after, threeId),
    { pile: "tableau", index: TARGET, row: 1 },
    `where the ${SUIT} 3 (id ${threeId}) sits after the move — it is the ` +
      "column's new lowest card. A reading naming the foundation is a build " +
      "that refused the pull-back",
  );
  assertLength(
    pileOf(after, "foundation", FOUNDATION),
    BUILT_TO - 1,
    `the cards left on foundation ${FOUNDATION} after the pull-back`,
  );
  assertEqual(
    topOf(pileOf(after, "foundation", FOUNDATION))?.id,
    twoId,
    `the id of foundation ${FOUNDATION}'s top card after the pull-back — the ` +
      `${SUIT} 2, which the three was sitting on`,
  );
  assertDeepEqual(
    whereIs(after, targetId),
    { pile: "tableau", index: TARGET, row: 0 },
    `where the ${TARGET_CARD.suit} 4 (id ${targetId}) sits after the move`,
  );
});
