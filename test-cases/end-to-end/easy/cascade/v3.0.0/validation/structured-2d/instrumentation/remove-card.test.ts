// instrumentation/remove-card — the named card leaves, and only it.
//
// THE RULE. specs/instrumentation.md, under The cards: "`removeCard(id)` —
// Removes the card with that id from whichever pile holds it", and "`removeCard`
// leaves the rest of that pile in its order." Two halves: the right card goes,
// and the pile closes up behind it rather than being rebuilt, re-sorted or
// truncated.
//
// THE CARD REMOVED IS THE MIDDLE ONE OF THREE, which is the only position that
// separates the models. A build that removes the pile's top card leaves
// `2, 6`; one that removes its bottom card leaves `6, 9`; one that empties the
// pile leaves nothing; one that removes the right card but rebuilds the pile in
// its own order leaves `9, 2`. Only the correct one leaves `2, 9` in that
// order, so the failure names what the build did.
//
// THE READING NAMES THE SURVIVORS BY ID as well as by rank, because "leaves the
// rest of that pile in its order" is about the cards that were there, not about
// two cards that happen to match: a card keeps its id for as long as it is on
// the table (specs/instrumentation.md, Identity).
//
// AND THE REMOVED CARD IS LOOKED FOR EVERYWHERE, so a build that moved it to
// another pile instead of removing it fails rather than passing on the pile it
// left.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertUndefined } from "../assert";
import {
  NINE,
  SIX,
  TWO,
  captureStill,
  card,
  createHarness,
  openTable,
  pileOf,
  poseColumn,
  siteOf,
  type Harness,
} from "../harness";

/** The column the three cards are posed on. */
const COLUMN = 5;

/** The three cards, bottom-most first, at three different ranks. */
const BOTTOM = card("clubs", TWO);
const MIDDLE = card("hearts", SIX);
const LOWEST = card("spades", NINE);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("removes the named card and leaves the rest of the pile in its order", async () => {
  openTable(h);
  const [bottomId, middleId, lowestId] = poseColumn(h, COLUMN, [
    BOTTOM,
    MIDDLE,
    LOWEST,
  ]);

  h.debug.removeCard(middleId);
  const after = h.snapshot();

  await h.advance(1);
  captureStill(h, "pile");

  assertDeepEqual(
    pileOf(after, "tableau", COLUMN).map((entry) => ({
      id: entry.id,
      suit: entry.suit,
      rank: entry.rank,
    })),
    [
      { id: bottomId, suit: BOTTOM.suit, rank: BOTTOM.rank },
      { id: lowestId, suit: LOWEST.suit, rank: LOWEST.rank },
    ],
    `column ${COLUMN} read bottom card first, after removeCard named the ` +
      "middle of its three cards: that card leaves and the rest of the pile " +
      "keeps its order (specs/instrumentation.md)",
  );

  assertUndefined(
    siteOf(after, middleId),
    "where the removed card is found on the table: removeCard takes it off " +
      "the pile that held it rather than moving it (specs/instrumentation.md)",
  );
});
