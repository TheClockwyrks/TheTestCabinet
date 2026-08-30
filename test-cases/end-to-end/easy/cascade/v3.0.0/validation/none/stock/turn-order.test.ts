// stock/turn-order — the cards are taken one at a time from the TOP of the
// stock, so the stock's top card ends up deepest of the group the turn moved and
// the last card taken is the waste's new top card.
//
// `specs/stock.md`: "The cards are taken one at a time from the top of the stock
// and placed face-up on the waste, so the stock's top card is the deepest of the
// group the turn moved and the last card taken is the waste's new top card."
//
// THE POSE MAKES EVERY WRONG MODEL READ AS A DIFFERENT PILE. Six distinct cards
// on the stock, a waste posed empty, and one turn. The waste is then read as a
// whole sequence, bottom card first, and so is the stock:
//
//   the rule          the stock's last cards, reversed, on the waste
//   from the bottom   the stock's FIRST cards on the waste, and a different
//                     remainder left behind
//   in one block      the right cards in the wrong order, oldest of them on top
//
// Reading the stock as well as the waste is what separates the second of those
// from the first: a build taking from the bottom moves the same NUMBER of cards
// and leaves a remainder that is different at both ends.
//
// UNDER DRAW ONE THE GROUP IS ONE CARD, and the point reduces to "the card that
// came over is the one that was on top". That is still a requirement a build can
// fail, and it is the same sentence of the specification, so the point is
// written once and sized to the build's own turn count.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual } from "../assert";
import {
  captureStill,
  cards,
  createHarness,
  faceDown,
  openTable,
  poseStock,
  type Harness,
} from "../harness";
import { keysOf, turnCount } from "./turns";

/**
 * The stock, bottom card first, so the LAST of these is its top card and the
 * first card the turn takes.
 */
const STOCK = ["2C", "3D", "4S", "5H", "6C", "7D"];

/** One frame, so the still carries the turned group. */
const DRAW_FRAMES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("lands the stock's top card deepest of the group it turned", async () => {
  await openTable(h);
  await poseStock(h, faceDown(...STOCK));

  const count = turnCount(await h.snapshot(), STOCK.length);

  await h.debug.turnStock();
  await h.advance(DRAW_FRAMES);
  await captureStill(h, "turned");

  // Taken one at a time from the top, each pushed onto the waste: the stock's
  // top card goes down first and the card `count` below it ends up on top.
  const posed = cards(...STOCK);
  const expectedWaste = keysOf(posed.slice(STOCK.length - count).reverse());
  const expectedStock = keysOf(posed.slice(0, STOCK.length - count));

  const after = await h.snapshot();
  assertDeepEqual(
    keysOf(after.waste),
    expectedWaste,
    "the cards on the waste after the turn, BOTTOM CARD FIRST — " +
      "specs/stock.md: they are taken one at a time from the top of the " +
      "stock, so the stock's top card is the deepest of them and the last " +
      "one taken is the waste's top card",
  );
  assertDeepEqual(
    keysOf(after.stock),
    expectedStock,
    "the cards left on the stock, bottom card first — the turn took them " +
      "off its top, so what is left is everything below the group it moved " +
      "(specs/stock.md)",
  );
});
