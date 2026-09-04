// draw-three/turn-count — a turn of the stock moves exactly three cards.
//
// THE RULE. specs/stock.md fixes this build's `TURN_COUNT` at `3` and states that
// "a turn of a stock holding cards moves `TURN_COUNT` cards onto the waste, or all
// that remain when the stock holds fewer than that". So a stock holding more than
// three cards loses exactly three to one turn, and the waste gains exactly three.
//
// THE POSE IS THE SMALLEST TABLE THE RULE NEEDS. Five face-down cards on the stock
// and nothing anywhere else. Five rather than three, so every wrong model reads as a
// different pair of counts: a build that turns one leaves four on the stock and one
// on the waste, a build that turns the whole pile leaves none and five, and the rule
// leaves two and three. Five is also more than the turn count, so this is the
// ordinary turn rather than the short-stock turn `draw-three/turn-remainder` decides.
//
// THE FIGURE IS WRITTEN OUT RATHER THAN IMPORTED. The build writes its own
// `src/constants.ts` and puts a `TURN_COUNT` in it, but this item's requirement
// is the literal three ("the stock loses three and the waste gains three"), so
// reading the figure back out of that module would let a build that turns one
// card and calls it `TURN_COUNT` pass. The literal is written here for the same
// reason `draw-three/deal-mode-reported` writes it: those two are the only
// points in this suite that hold the count against the specification, and every
// other check may size itself to the figure the build reports.
//
// THE COUNTS ALONE ARE DECIDED HERE. Which card ended up on top is `stock.turn-order`,
// the set the turn appends is `stock.turn-starts-a-set`, and that the turned cards
// are face-up is `stock.turned-cards-face-up`.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  openTable,
  poseStock,
  type Harness,
} from "../harness";

/** The turn count specs/stock.md fixes for this variant, as `TURN_COUNT`. */
const TURN_COUNT = 3;

/**
 * The stock the turn is taken from, bottom card first.
 *
 * Face-down, which is what a card on the stock is (specs/deal.md), and two cards
 * more than the turn count, so the pile still holds cards afterwards.
 */
const STOCK = ["#2H", "#3D", "#4C", "#5S", "#6H"];

/** What the stock is left holding: five cards less the three a turn moves. */
const STOCK_AFTER = STOCK.length - TURN_COUNT;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("moves three cards from the stock to the waste", async () => {
  openTable(h);
  poseStock(h, STOCK);

  h.debug.turnStock();
  const after = h.snapshot();
  await h.advance(1);
  captureStill(h, "turn");

  assertLength(
    after.waste,
    TURN_COUNT,
    "cards one turn put on the waste, which is this variant's TURN_COUNT of " +
      `${TURN_COUNT} (specs/stock.md)`,
  );
  assertLength(
    after.stock,
    STOCK_AFTER,
    `cards left on a stock of ${STOCK.length} after one turn (specs/stock.md)`,
  );
});
