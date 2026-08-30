// tableau/reject-equal-rank — a column refuses a card of its own rank.
//
// THE RULE. `specs/tableau.md`: a column whose lowest card is face-up, of rank
// `r` and color `c`, accepts a run led by a card of rank `r - 1` and the other
// color, and "refuses every other run offered to it". A card of rank `r` is one
// of those, however its color falls. This check decides that edge, which is the
// one a build reaching for a `<=` rather than a `- 1` gets wrong.
//
// THE POSE HOLDS THE COLOR RIGHT AND THE RANK EQUAL, so nothing but the rank
// comparison can decide the verdict. The column shows the eight of spades, black
// and of rank 8; the card offered is the eight of hearts, red and of rank 8. A
// build that asks whether the offered rank is "at most" the column's takes it,
// and so does a build that never compares ranks at all; a build that asks for
// exactly one below refuses it. Both wrong models leave the column holding two
// cards, and `tableau/reject-rank-gap` is the point that tells them apart.
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
const TARGET_CARD = card("8S");

/** The column the card is offered from. */
const SOURCE = 1;
/** The SAME rank as the target's card, in the other color. */
const SOURCE_CARD = card("8H");

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

it("refuses a card of its own rank, and leaves it where it was", async () => {
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
    `move's verdict on the ${SOURCE_CARD.suit} 8 offered to a column showing ` +
      `the ${TARGET_CARD.suit} 8 — specs/tableau.md: a column takes the rank ` +
      "one below its lowest card, so an equal rank is refused",
  );
  assertLength(
    pileOf(after, "tableau", TARGET),
    1,
    `the cards in column ${TARGET} after the offer — two is a build that ` +
      "compared the ranks with an at-most rather than a one-below",
  );
  assertDeepEqual(
    whereIs(after, offeredId),
    { pile: "tableau", index: SOURCE, row: 0 },
    `where the ${SOURCE_CARD.suit} 8 (id ${offeredId}) sits after the ` +
      "refusal — specs/tableau.md: a refused move changes nothing",
  );
  assertDeepEqual(
    whereIs(after, targetId),
    { pile: "tableau", index: TARGET, row: 0 },
    `where the ${TARGET_CARD.suit} 8 (id ${targetId}) sits after the refusal`,
  );
});
