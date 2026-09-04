// stock/recycle-clears-sets — a recycle forgets the sets with the cards.
//
// THE RULE. specs/stock.md: after a recycle "the waste is left empty and its set
// memory is emptied with it", and specs/instrumentation.md fixes what
// `wasteVisibleCount` then reads: "the newest entry of `wasteSets`, and `0` when
// `wasteSets` is empty". A memory that survived the recycle would have the empty
// waste claiming to show cards it no longer holds, and specs/table.md's empty-slot
// mark would never be drawn there.
//
// THE MEMORY IS POSED WITH TWO ENTRIES, so a build that dropped only the newest one
// is caught by what is left rather than by an already-empty memory.
//
// BOTH READINGS ARE THE ONE SENTENCE. `wasteSets` is the memory itself and
// `wasteVisibleCount` is what the waste says it is showing; a build that emptied the
// list but kept reporting a count is showing the player a card off an empty pile.
// The cards themselves are `stock/recycle-clears-waste`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import {
  captureStill,
  card,
  createHarness,
  FOUR,
  NINE,
  openTable,
  poseWaste,
  TWO,
  type Harness,
} from "../harness";

/** The waste the recycle empties: three cards under two sets. */
const POSED_WASTE = [
  card("clubs", TWO),
  card("diamonds", NINE),
  card("spades", FOUR),
];
const POSED_SETS = [1, 2] as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("empties the waste's set memory when it recycles", async () => {
  openTable(h);
  poseWaste(h, POSED_WASTE, POSED_SETS);

  h.debug.turnStock();
  const after = h.snapshot();

  await h.advance(1);
  captureStill(h, "recycled");

  assertLength(
    after.wasteSets,
    0,
    "entries in the waste's set memory after a recycle (specs/stock.md)",
  );
  assertEqual(
    after.wasteVisibleCount,
    0,
    "wasteVisibleCount on a waste whose set memory a recycle emptied " +
      "(specs/instrumentation.md)",
  );
});
