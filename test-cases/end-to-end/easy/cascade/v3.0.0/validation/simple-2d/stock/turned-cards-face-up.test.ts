// stock/turned-cards-face-up — a turn brings its cards over face-up.
//
// THE RULE. specs/stock.md: the cards "are taken one at a time from the top of the
// stock and placed face-up on the waste". The stock is a face-down pile
// (specs/deal.md), so the turn is what turns them: a build that carried them across
// without changing their faces would show the player a waste of card backs and no
// card to play.
//
// THE STOCK IS POSED FACE-DOWN, deliberately, which is what makes this a reading of
// the turn rather than of the pose. `stockSpecs` marks every card face-down, and the
// waste is empty before the turn, so every card on the waste afterwards is one the
// turn put there.
//
// EVERY TURNED CARD IS NAMED SEPARATELY, by the card it is, so a build that turns
// the last card of a three-card group and leaves the other two face-down fails with
// the first card that disagreed named rather than with a bare count.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual } from "../assert";
import {
  captureStill,
  cardSpec,
  createHarness,
  openTable,
  poseStock,
  type Harness,
} from "../harness";
import { stockSpecs } from "./turning";

/** Cards posed on the stock, longer than either deal mode's turn. */
const STOCK_SIZE = 12;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("places every card a turn moves face-up on the waste", async () => {
  openTable(harness);
  poseStock(harness, stockSpecs(STOCK_SIZE));
  harness.debug.turnStock();

  await harness.advance(1);
  captureStill(harness, "turned");

  const { waste } = harness.snapshot();
  assertGreaterThanOrEqual(
    waste.length,
    1,
    "cards a turn of a twelve-card stock put on the waste (specs/stock.md)",
  );
  for (const card of waste) {
    assertEqual(
      card.faceUp,
      true,
      `the face of the ${cardSpec({ ...card, faceUp: true })} the turn ` +
        "brought onto the waste (specs/stock.md)",
    );
  }
});
