// automove/obeys-rank — a card two ranks above a foundation's top card is not
// sent.
//
// `specs/foundations.md` fixes the rank rule: "Cards, its top card being rank
// `r` of suit `s` | The card of rank `r + 1` and suit `s`", and the foundation
// "refuses every other card offered to it".
//
// THE POSE CLOSES EVERY OTHER ROUTE HOME, so what is graded is the rank rule
// alone. All four foundations are started, the seven of spades' own suit stands
// at the five, and the card missing between them is nowhere on the table: there
// is no empty foundation for a build to fall back on, and no foundation of
// another suit that could take a spade. The only question left is whether the
// build offers `r + 1` or anything above it. The empty-board half of the same
// refusal is `automove/illegal-does-nothing`.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import {
  cards,
  captureStill,
  createHarness,
  openTable,
  pileOf,
  poseColumn,
  poseFoundation,
  topOf,
  whereIs,
  type Harness,
} from "../harness";

/** The spades foundation and the rank it stands at, which is `r`. */
const SPADES_FOUNDATION = 0;
const SPADES_UP_TO = 5;

/** The three other foundations, so no empty slot is left as a fallback. */
const OTHERS = [
  { index: 1, suit: "hearts" as const },
  { index: 2, suit: "diamonds" as const },
  { index: 3, suit: "clubs" as const },
];
const OTHERS_UP_TO = 4;

/** The column the card is offered from, and the card: rank `r + 2` of spades. */
const COLUMN = 2;
const OFFERED = "7S";

/** One frame, so the canvas carries the board the assertions read. */
const SETTLE_FRAMES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("refuses a card two ranks above the foundation's top card", async () => {
  await openTable(h);
  await poseFoundation(h, SPADES_FOUNDATION, "spades", SPADES_UP_TO);
  for (const { index, suit } of OTHERS) {
    await poseFoundation(h, index, suit, OTHERS_UP_TO);
  }
  const [offeredId] = await poseColumn(h, COLUMN, cards(OFFERED));

  const went = await h.debug.autoMove("tableau", COLUMN);
  await h.advance(SETTLE_FRAMES);
  await captureStill(h, "unchanged");

  assertEqual(went, false, "the verdict autoMove returned");

  const after = await h.snapshot();
  assertDeepEqual(
    whereIs(after, offeredId),
    { pile: "tableau", index: COLUMN, row: 0 },
    "where the skipped rank still lies",
  );
  assertEqual(
    topOf(pileOf(after, "foundation", SPADES_FOUNDATION))?.rank,
    SPADES_UP_TO,
    "the rank the spades foundation still shows",
  );
  assertLength(
    pileOf(after, "foundation", SPADES_FOUNDATION),
    SPADES_UP_TO,
    "the cards on the spades foundation after the refusal",
  );
  for (const { index } of OTHERS) {
    assertLength(
      pileOf(after, "foundation", index),
      OTHERS_UP_TO,
      `the cards on foundation ${index} after the refusal`,
    );
  }
});
