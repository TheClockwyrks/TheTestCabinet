// tableau/reject-same-color — a column refuses the card below it in its own
// color.
//
// THE RULE. `specs/tableau.md`: a column whose lowest card is face-up, of rank
// `r` and color `c`, accepts a run led by a card of rank `r - 1` and "the color
// other than `c`", and "refuses every other run offered to it". This check
// decides the color half of that row in the REFUSING direction, which the
// accepting check cannot reach.
//
// THE POSE HOLDS THE RANK RIGHT AND THE COLOR WRONG, so the only thing that can
// decide the verdict is the color rule. The column shows the eight of spades,
// black and of rank 8; the card offered is the seven of clubs, black and of rank
// 7. A build with no color rule at all takes it, and so does a build that has
// the rule inverted and demands the SAME color — both read as an acceptance
// here, and `tableau/build-down-alternating` is what tells those two apart, by
// refusing the alternating card the inverted build refuses. Only a build with
// the stated rule leaves the column holding its eight alone.
//
// THE SEVEN SITS IN A COLUMN OF ITS OWN, so a refusal that quietly moved it
// somewhere else is named by `whereIs` rather than hidden.
//
// The four faculty gates are left at their reset defaults, which are all on.
// A refused move applies nothing, so none of them has anything to do.

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
/** One rank below the target's card and the SAME color: what the rule refuses. */
const SOURCE_CARD = card("7C");

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

it("refuses a card one rank lower of its own color, and leaves it where it was", async () => {
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
      `the ${TARGET_CARD.suit} 8, both black — specs/tableau.md: a column ` +
      "takes the next rank down in the OTHER color, and refuses every other " +
      "run offered to it",
  );
  assertLength(
    pileOf(after, "tableau", TARGET),
    1,
    `the cards in column ${TARGET} after the offer — two is a build that ` +
      "checked the rank and not the color",
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
    `where the ${TARGET_CARD.suit} 8 (id ${targetId}) sits after the refusal`,
  );
});
