// draw-one/turn-count — one turn of a stock that holds cards moves exactly ONE
// card: the stock is smaller by one and the waste larger by one.
//
// `specs/stock.md` fixes both halves. The figure: "This build plays Draw One …
// `TURN_COUNT` | `1`". The rule: "A turn of a stock holding cards moves
// `TURN_COUNT` cards onto the waste, or all that remain when the stock holds
// fewer than that. The cards are taken one at a time from the top of the stock
// and placed face-up on the waste".
//
// THIS IS THE POINT THAT PINS THE FIGURE. Every COMMON check that has to size
// itself to the deal mode reads `snapshot().turnCount` instead of writing a
// number (`stock/turn-moves-to-waste` is the common half of this rule), so one
// suite stays honest across both variants. `TURN_COUNT` below, imported from this
// directory's own `constants.ts`, is the specification's literal, and this check
// and its five neighbours are the only ones in the project allowed to read it.
//
// WHY A STOCK OF FIVE. The turn is measured as a DIFFERENCE, over a stock deep
// enough that every wrong model reads a different number and none is clamped by
// the size of the pile: a build turning three leaves four on the waste short by
// two and reads `3`, a build turning the whole stock reads `5`, a build turning
// nothing reads `0`. A stock of one would have made all four models agree.
// Nothing here asserts WHICH cards moved or which way up they landed —
// `stock/turn-order` and `stock/turned-cards-face-up` decide those.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  cards,
  createHarness,
  openTable,
  poseStock,
  type Harness,
} from "../harness";
import { TURN_COUNT } from "./constants";

/**
 * The stock the turn is taken from, bottom card first, so `7C` is its top card
 * and the first one a turn takes.
 *
 * Five cards: deeper than any turn count a wrong build could implement, so the
 * difference this check reads is the build's own figure rather than the pile
 * running out.
 */
const STOCK = ["2C", "5H", "9S", "4D", "7C"] as const;

/** One frame, so the still carries the board the assertions read. */
const SETTLE_FRAMES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("takes one card off the stock and puts one on the waste", async () => {
  await openTable(h);
  await poseStock(h, cards(...STOCK));

  const before = await h.snapshot();

  await h.debug.turnStock();
  await h.advance(SETTLE_FRAMES);
  await captureStill(h, "turn");

  const after = await h.snapshot();

  assertEqual(
    before.stock.length - after.stock.length,
    TURN_COUNT,
    "cards the turn took off the stock",
  );
  assertEqual(
    after.waste.length - before.waste.length,
    TURN_COUNT,
    "cards the turn put on the waste",
  );
});
