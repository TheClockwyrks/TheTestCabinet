// instrumentation/remove-card — `removeCard` takes exactly the card it was named.
//
// specs/instrumentation.md: `removeCard` "removes the card with that id from
// whichever pile holds it" and "leaves the rest of that pile in its order".
//
// THE CARD REMOVED IS IN THE MIDDLE OF ITS PILE, which is the only place the order
// rule can be read: a build that rebuilt the pile around the gap, or that removed
// by position rather than by id, leaves the survivors in some other order, and a
// build that took the top card instead of the named one leaves a different card
// missing. A pile of five with the middle card taken tells all three apart.
//
// AND THE CARD IS GONE FROM THE TABLE, not merely from its pile. `placeOf` searches
// all thirteen piles, so a build that moved the card somewhere else instead of
// removing it is caught here rather than surfacing later as a stray card in some
// other check's scenario.
//
// THE FIVE CARDS ARE ALL DIFFERENT, so the surviving order is legible in the
// reading rather than being four cards that happen to match.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertNull } from "../assert";
import {
  captureStill,
  createHarness,
  openTable,
  pileOf,
  pileSpecs,
  placeOf,
  poseColumn,
  type Harness,
} from "../harness";

/** The column posed, its five cards bottom first, and which of them is removed. */
const COLUMN = 2;
const CARDS = ["#5D", "KS", "QH", "JC", "10D"];
const REMOVED_ROW = 2;

/** What the column holds once the named card has gone. */
const SURVIVORS = CARDS.filter((_, row) => row !== REMOVED_ROW);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("removes the named card and leaves the rest of the pile in order", async () => {
  openTable(h);
  const ids = poseColumn(h, COLUMN, CARDS);
  const removed = ids[REMOVED_ROW];

  h.debug.removeCard(removed);
  const after = h.snapshot();

  // The pile with the named card gone.
  await h.advance(1);
  captureStill(h, "pile");

  assertDeepEqual(
    pileSpecs(pileOf(after, "tableau", COLUMN)),
    SURVIVORS,
    `tableau ${COLUMN}, bottom card first, once ${CARDS[REMOVED_ROW]} has been ` +
      "removed: the rest of the pile keeps its order " +
      "(specs/instrumentation.md)",
  );
  assertDeepEqual(
    pileOf(after, "tableau", COLUMN).map((card) => card.id),
    ids.filter((_, row) => row !== REMOVED_ROW),
    `the ids left on tableau ${COLUMN}: the cards that stayed are the cards ` +
      "that were posed",
  );
  assertNull(
    placeOf(after, removed),
    `the pile holding the card with id ${removed}, which removeCard took off ` +
      "the table (specs/instrumentation.md)",
  );
});
