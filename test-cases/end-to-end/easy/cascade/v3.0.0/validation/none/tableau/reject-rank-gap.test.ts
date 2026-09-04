// tableau/reject-rank-gap — a column refuses a card that skips a rank.
//
// THE RULE. `specs/tableau.md`: a column whose lowest card is face-up, of rank
// `r` and color `c`, accepts a run led by a card of rank `r - 1` and the other
// color. `r - 1` is ONE rank down and no further, so a card two ranks down is
// among the runs the column "refuses". This check decides that edge of the rank
// rule, and it is its own point because a build that skips it is a build that
// lets a player bury a rank.
//
// THE POSE HOLDS THE COLOR RIGHT AND THE DISTANCE WRONG, so nothing but the size
// of the rank step can decide the verdict. The column shows the nine of spades,
// black and of rank 9; the card offered is the seven of hearts, red and of rank
// 7, which alternates correctly and lies two ranks below rather than one. A
// build that checks only that the offered rank is LOWER than the column's takes
// it; a build that checks the exact step refuses it. The gap is exactly one rank
// wide, which is the smallest miss the rule admits, so a build that accepts
// anything looser than the stated step fails here.
//
// The four faculty gates are left at their reset defaults, which are all on. A
// refused move applies nothing, so none of them has anything to do.

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
const TARGET_CARD = card("9S");

/** The column the card is offered from. */
const SOURCE = 1;
/** TWO ranks below the target's card, in the other color. */
const SOURCE_CARD = card("7H");

/** Where the offered card sits in its column, counted from the bottom. */
const SOURCE_ROW = 0;

/** One frame, so the still shows the board the refusal left. */
const DRAW_FRAMES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("refuses a card two ranks lower, and leaves it where it was", async () => {
  await openTable(h);
  const [targetId] = await poseColumn(h, TARGET, [TARGET_CARD]);
  const [offeredId] = await poseColumn(h, SOURCE, [SOURCE_CARD]);

  const accepted = await h.debug.move(
    "tableau",
    SOURCE,
    SOURCE_ROW,
    "tableau",
    TARGET,
  );

  await h.advance(DRAW_FRAMES);
  await captureStill(h, "refused");
  const after = await h.snapshot();

  assertEqual(
    accepted,
    false,
    `move's verdict on the ${SOURCE_CARD.suit} 7 offered to a column showing ` +
      `the ${TARGET_CARD.suit} 9 — specs/tableau.md: a column takes the rank ` +
      "one below its lowest card, not any rank below it",
  );
  assertLength(
    pileOf(after, "tableau", TARGET),
    1,
    `the cards in column ${TARGET} after the offer — two is a build that ` +
      "asked only whether the offered rank was lower",
  );
  assertDeepEqual(
    whereIs(after, offeredId),
    { pile: "tableau", index: SOURCE, row: 0 },
    `where the ${SOURCE_CARD.suit} 7 (id ${offeredId}) sits after the ` +
      "refusal — specs/tableau.md: a refused move changes nothing",
  );
  assertDeepEqual(
    whereIs(after, targetId),
    { pile: "tableau", index: TARGET, row: 0 },
    `where the ${TARGET_CARD.suit} 9 (id ${targetId}) sits after the refusal`,
  );
});
