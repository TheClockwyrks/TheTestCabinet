// stock/recycle-preserves-order — the recycled stock turns the same cards up
// again in the same order.
//
// `specs/stock.md`: "every card on the waste returns to the stock face-down, in
// reverse order, so the card that lay at the bottom of the waste is the stock's
// top card and a further pass turns the same cards up in the same order."
//
// THE READING IS THE SECOND PASS, not the stock's internal order. The
// specification states the reversal for a reason a player can see — the cards
// come back round in the order they came round the first time — so this point
// drives the next pass and reads the waste it rebuilds. That makes the point
// decide the rule rather than one implementation of it: a build that keeps its
// stock in the other direction and turns from the other end is spec-compliant
// and passes here, while a build that recycled the waste unreversed reads as a
// waste rebuilt back to front.
//
// THE CARDS ARE DISTINCT AND THE COMPARISON IS A SEQUENCE, so every wrong model
// reads as a different pile: reversed, rotated by one, or shuffled.
//
// THE RECYCLE ITSELF IS CONFIRMED FIRST, because it is the precondition rather
// than the requirement: a build that did not recycle at all leaves the waste
// standing with its cards already in the right order, and reading the order
// alone would pass it. `stock.empty-stock-recycles` is what grades the recycle.
//
// SIX CARDS IS A WHOLE NUMBER OF TURNS UNDER EITHER DEAL MODE, so the second
// pass is made of full turns and the short-turn rule is not in play.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertLength } from "../assert";
import {
  captureStill,
  cards,
  createHarness,
  openTable,
  poseWaste,
  type Harness,
} from "../harness";
import { drainStock, keysOf, turnCount, turnSets } from "./turns";

/** The waste, bottom card first, all distinct and six of them. */
const WASTE = ["2C", "3D", "4S", "5H", "6C", "7D"];

/** One frame, so the still carries the waste the second pass rebuilt. */
const DRAW_FRAMES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("turns the same cards up again in the same order", async () => {
  await openTable(h);
  const count = turnCount(await h.snapshot());
  await poseWaste(h, cards(...WASTE), turnSets(WASTE.length, count));

  await h.debug.turnStock();

  const recycled = await h.snapshot();
  assertLength(
    recycled.stock,
    WASTE.length,
    "the cards the recycle put on the stock — the precondition this point's " +
      "reading rests on (specs/stock.md)",
  );
  assertLength(
    recycled.waste,
    0,
    "the cards left on the waste after the recycle — the second pass has to " +
      "rebuild it from the stock rather than find it standing (specs/stock.md)",
  );

  await drainStock(h, WASTE.length);
  await h.advance(DRAW_FRAMES);
  await captureStill(h, "turned");

  const after = await h.snapshot();
  assertDeepEqual(
    keysOf(after.waste),
    keysOf(cards(...WASTE)),
    "the cards the second pass turned up, bottom card first — " +
      "specs/stock.md: the waste returns to the stock in reverse order, so a " +
      "further pass turns the same cards up in the same order. A waste read " +
      "back to front here is a recycle that did not reverse",
  );
});
