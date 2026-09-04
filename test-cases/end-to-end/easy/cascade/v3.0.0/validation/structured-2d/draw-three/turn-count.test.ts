// Cascade — draw-three/turn-count: one turn of the stock moves exactly three cards.
//
// specs/stock.md fixes this build's `TURN_COUNT` at `3` and states that a turn of
// a stock holding cards moves `TURN_COUNT` cards onto the waste, taken one at a
// time from the top. This point decides the COUNT alone: which of those cards
// ends up where is `stock.turn-order`'s, and the set the turn records is
// `stock.turn-starts-a-set`'s.
//
// The common item `stock.turn-moves-to-waste` decides the same shape against
// whatever turn count the build REPORTS, so it passes a build that consistently
// turns one card and says so. This item is the one that pins the literal the
// specification fixes for Draw Three, which is why it exists at all.
//
// The stock is posed with more than twice the turn count, so every wrong model
// reads as its own number: a build that turned one leaves seven, one that turned
// two leaves six, one that turned six leaves two, and one that emptied the stock
// leaves none. The waste is left empty and no other card is on the table —
// `openTable` clears all thirteen piles — so nothing but the turn can move a card
// and neither reading is clamped by the size of the pile.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  card,
  createHarness,
  EIGHT,
  FIVE,
  FOUR,
  NINE,
  openTable,
  poseStock,
  SEVEN,
  SIX,
  THREE,
  TWO,
  type Harness,
} from "../harness";
import { TURN_COUNT } from "./constants";

/**
 * The stock this check poses, bottom card first.
 *
 * Eight distinct cards: more than twice `TURN_COUNT`, so a build that turned one,
 * two, four, six or the whole pile leaves a different number of cards behind, and
 * enough that the turn is a full one rather than the short one
 * `draw-three/turn-remainder` decides.
 */
const STOCK = [
  card("spades", TWO),
  card("hearts", THREE),
  card("diamonds", FOUR),
  card("clubs", FIVE),
  card("spades", SIX),
  card("hearts", SEVEN),
  card("diamonds", EIGHT),
  card("clubs", NINE),
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("moves exactly three cards from the stock to the waste", async () => {
  openTable(h);
  poseStock(h, STOCK);

  h.debug.turnStock();

  await h.drawFrame();
  captureStill(h, "turn");

  const after = h.snapshot();
  assertEqual(
    after.stock.length,
    STOCK.length - TURN_COUNT,
    "cards left on the stock after one turn",
  );
  assertEqual(
    after.waste.length,
    TURN_COUNT,
    "cards the turn put on the waste",
  );
});
