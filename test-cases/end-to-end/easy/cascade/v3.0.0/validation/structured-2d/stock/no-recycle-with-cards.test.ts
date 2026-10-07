// stock/no-recycle-with-cards — a stock that still holds cards turns.
//
// THE RULE. specs/stock.md: "A turn of a stock that holds cards never recycles."
// The two things a turn can do are told apart by one condition, and only one of them
// is right at a time: a build that recycled while the stock still held cards would
// bury the waste back under a stock the player had not finished, and a player could
// never reach the cards at the bottom of it.
//
// THE TWO OUTCOMES READ AS OPPOSITE MOVEMENTS, which is what makes this point decide
// the CHOICE rather than the turn. A turn takes cards off the stock and puts them on
// the waste, so the stock shrinks and the waste grows; a recycle takes the whole
// waste back, so the stock grows and the waste is emptied. So the stock is posed
// holding cards, the waste is posed holding some already, and both piles are read
// afterwards: a build that turned moves in one direction, a build that recycled
// moves in the other, and the failure names which it did.
//
// THE CARDS ALREADY ON THE WASTE ARE FOLLOWED BY ID, and they have to still be at
// the bottom of it in their order, because a recycle would have taken exactly those
// away. That is the reading that a build cannot answer by doing both.
//
// How MANY cards the turn moved is `stock/turn-moves-to-waste`; that an EMPTY stock
// recycles is `stock/empty-stock-recycles`.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertGreaterThan, assertLessThan } from "../assert";
import {
  captureStill,
  card,
  createHarness,
  NINE,
  openTable,
  poseStock,
  poseWaste,
  TWO,
  type Harness,
} from "../harness";
import { stockSpecs } from "./turning";

/** Cards posed on the stock, longer than either deal mode's turn. */
const STOCK_SIZE = 12;

/** The cards already on the waste, which a recycle would take away. */
const POSED_WASTE = [card("clubs", TWO), card("diamonds", NINE)];
const POSED_SETS = [1, 1] as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("turns onto the waste rather than recycling when the stock holds cards", async () => {
  openTable(h);
  const kept = poseWaste(h, POSED_WASTE, POSED_SETS);
  poseStock(h, stockSpecs(STOCK_SIZE));

  h.debug.turnStock();
  const after = h.snapshot();

  await h.advance(1);
  captureStill(h, "turned");

  assertLessThan(
    after.stock.length,
    STOCK_SIZE,
    "cards on the stock after a turn of a stock that still held cards, which " +
      "takes cards off it rather than putting the waste back on it " +
      "(specs/stock.md)",
  );
  assertGreaterThan(
    after.waste.length,
    POSED_WASTE.length,
    "cards on the waste after a turn of a stock that still held cards, which " +
      "adds to the waste rather than emptying it (specs/stock.md)",
  );
  assertDeepEqual(
    after.waste.slice(0, kept.length).map((reported) => reported.id),
    kept,
    "the ids at the bottom of the waste after the turn, which a recycle would " +
      "have taken back to the stock (specs/stock.md)",
  );
});
