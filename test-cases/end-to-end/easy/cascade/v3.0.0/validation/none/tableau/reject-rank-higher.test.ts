// tableau/reject-rank-higher — a column refuses the card above it, however its
// color falls.
//
// THE RULE. `specs/tableau.md`: a column whose lowest card is face-up, of rank
// `r` and color `c`, accepts a run led by a card of rank `r - 1`. A column
// builds DOWN, so the card one rank ABOVE its lowest card is one of the runs it
// "refuses". This check decides that direction of the rank rule.
//
// THE POSE HOLDS THE COLOR RIGHT AND THE RANK ON THE WRONG SIDE, so nothing but
// the direction of the rank rule can decide the verdict. The column shows the
// eight of spades, black and of rank 8; the card offered is the nine of hearts,
// red and of rank 9. A build that only checks that the colors alternate takes
// it; so does a build that checks the ranks are adjacent without caring which
// way; so does a build that has the columns building UP the way the foundations
// do. Each of those reads as an acceptance here and each is refused by a
// different point — `tableau/build-down-alternating` for the first two, the
// `foundations` group for the third — so a failure here names the build that
// got the direction wrong.
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
/** One rank ABOVE the target's card, in the other color. */
const SOURCE_CARD = card("9H");

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

it("refuses a card one rank higher, and leaves it where it was", async () => {
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
    `move's verdict on the ${SOURCE_CARD.suit} 9 offered to a column showing ` +
      `the ${TARGET_CARD.suit} 8 — specs/tableau.md: a column builds DOWN, so ` +
      "it takes the rank below its lowest card and refuses the rank above it",
  );
  assertLength(
    pileOf(after, "tableau", TARGET),
    1,
    `the cards in column ${TARGET} after the offer — two is a build that ` +
      "read the rank rule without its direction",
  );
  assertDeepEqual(
    whereIs(after, offeredId),
    { pile: "tableau", index: SOURCE, row: 0 },
    `where the ${SOURCE_CARD.suit} 9 (id ${offeredId}) sits after the ` +
      "refusal — specs/tableau.md: a refused move changes nothing",
  );
  assertDeepEqual(
    whereIs(after, targetId),
    { pile: "tableau", index: TARGET, row: 0 },
    `where the ${TARGET_CARD.suit} 8 (id ${targetId}) sits after the refusal`,
  );
});
