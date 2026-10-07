// tableau/accepts-from-foundation — a column takes a card pulled back off a
// foundation.
//
// specs/tableau.md: "a column accepts a run from another column, from the waste, and
// from a foundation, on exactly the terms above" — the terms being rank one lower
// and the other color.
// specs/instrumentation.md: on a squared pile, which a foundation is
// (specs/table.md), a `fromRow` naming the top card takes that card alone.
//
// WHAT THIS ITEM DECIDES is the SOURCE, not the rule: the pair of cards is the same
// legal pair `build-down-alternating` uses, and the only thing changed is where the
// offered card comes from. A build that treats the foundations as one-way — cards go
// home and never come back — refuses here and passes every other item in this group.
//
// THE FOUNDATION IS BUILT TO ITS EIGHT rather than holding that card alone, so the
// pull names the top of a stack of eight rather than a pile of one: a build that
// reaches for a foundation's FIRST card, or that treats a foundation of one card as
// a special case, is caught. What it leaves behind is read as well as what it gave
// up, so a foundation that handed over the card by emptying itself is not mistaken
// for one that gave up its top card.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  openTable,
  pileSpecs,
  poseColumn,
  poseFoundation,
  type Harness,
} from "../harness";

/** The foundation the card is pulled off, and the rank it is built to. */
const FOUNDATION = 0;
const FOUNDATION_TOP_RANK = 8;
/** Its top card, which is what the move takes, and the card left under it. */
const PULLED = "8S";
const LEFT_ON_TOP = "7S";
/** The column it lands on, and that column's lowest card. */
const TARGET = 3;
const TARGET_LOWEST = "9H";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("accepts a foundation's top card onto a legal column", async () => {
  openTable(h);
  poseFoundation(h, FOUNDATION, "spades", FOUNDATION_TOP_RANK);
  poseColumn(h, TARGET, [TARGET_LOWEST]);

  // The top of a foundation built to its eight is the eighth card, at row 7.
  const accepted = h.debug.move(
    "foundation",
    FOUNDATION,
    FOUNDATION_TOP_RANK - 1,
    "tableau",
    TARGET,
  );
  const after = h.snapshot();
  await h.advance(1);
  captureStill(h, "accepted");

  assertEqual(
    accepted,
    true,
    `move of ${PULLED}, the top of the spade foundation, onto column ` +
      `${TARGET}, whose lowest card is ${TARGET_LOWEST}: a column accepts ` +
      "from a foundation on the same terms (specs/tableau.md)",
  );
  assertDeepEqual(
    pileSpecs(after.tableau[TARGET]),
    [TARGET_LOWEST, PULLED],
    `column ${TARGET} after the move: the pulled card is its new lowest card ` +
      "(specs/tableau.md)",
  );
  assertLength(
    after.foundations[FOUNDATION],
    FOUNDATION_TOP_RANK - 1,
    `the cards left on foundation ${FOUNDATION}: it gave up one card, the ` +
      "one the move named (specs/tableau.md)",
  );
  assertDeepEqual(
    pileSpecs(after.foundations[FOUNDATION]).slice(-1),
    [LEFT_ON_TOP],
    `the top of foundation ${FOUNDATION} after the move: the card that was ` +
      "under the one pulled back (specs/tableau.md)",
  );
});
