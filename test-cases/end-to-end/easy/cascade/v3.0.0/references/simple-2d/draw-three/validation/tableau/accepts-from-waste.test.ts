// tableau/accepts-from-waste — a column takes the waste's top card on the same
// terms.
//
// specs/tableau.md: "a column accepts a run from another column, from the waste, and
// from a foundation, on exactly the terms above" — the terms being rank one lower
// and the other color.
// specs/instrumentation.md: `move` names its source with `fromPile`, `fromIndex` and
// `fromRow`, and on a squared pile a `fromRow` naming the top card takes that card
// alone.
//
// WHAT THIS ITEM DECIDES is the SOURCE, not the rule: the rule itself is
// `build-down-alternating`'s. So the pair of cards is the same legal pair that item
// uses, and the only thing changed is where the offered card comes from. A build
// that accepts a card from a column and refuses the identical card from the waste
// fails here and passes there, which is exactly the reading this item is for.
//
// The waste holds that one card, in a set of one, so it is the waste's top card and
// the waste shows it (specs/stock.md); nothing else is on the table.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  openTable,
  pileSpecs,
  poseColumn,
  poseWaste,
  type Harness,
} from "../harness";

/** The column the waste's card lands on, holding one face-up card. */
const TARGET = 3;
/** Its lowest card: rank nine, red. */
const TARGET_LOWEST = "9H";
/** The waste's only card: one rank lower, and the other color. */
const OFFERED = "8S";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("accepts the waste's top card onto a legal column", async () => {
  openTable(h);
  poseColumn(h, TARGET, [TARGET_LOWEST]);
  poseWaste(h, [OFFERED], [1]);

  const accepted = h.debug.move("waste", 0, 0, "tableau", TARGET);
  const after = h.snapshot();
  await h.advance(1);
  captureStill(h, "accepted");

  assertEqual(
    accepted,
    true,
    `move of the waste's top card ${OFFERED} onto column ${TARGET}, whose ` +
      `lowest card is ${TARGET_LOWEST}: a column accepts from the waste on ` +
      "the same terms (specs/tableau.md)",
  );
  assertDeepEqual(
    pileSpecs(after.tableau[TARGET]),
    [TARGET_LOWEST, OFFERED],
    `column ${TARGET} after the move: the waste's card is its new lowest ` +
      "card (specs/tableau.md)",
  );
  assertLength(
    after.waste,
    0,
    "the cards left on the waste: the card it held has gone to the column " +
      "(specs/tableau.md)",
  );
});
