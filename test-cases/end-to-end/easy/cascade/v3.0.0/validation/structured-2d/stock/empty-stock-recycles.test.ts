// stock/empty-stock-recycles — an empty stock takes the whole waste back.
//
// THE RULE. specs/stock.md: "A turn of an empty stock recycles instead: every card
// on the waste returns to the stock face-down". Every card, not some of them, and
// face-down, because the stock is a face-down pile and the recycled cards are turned
// up again by the passes that follow. Without this the game ends the moment the
// stock runs out.
//
// THREE THINGS ARE READ, and they are the three the sentence states: the stock holds
// as many cards as the waste did, it holds exactly THOSE cards, and every one of
// them is face-down. The cards are matched by id, which a card keeps for as long as
// it is on the table (specs/instrumentation.md), so a build that refilled the stock
// with new cards of the same ranks is caught; they are compared as a sorted set,
// because the ORDER the recycle leaves them in is `stock/recycle-preserves-order`.
//
// THE WASTE IS POSED FACE-UP, which is what a card on the waste is (specs/stock.md),
// so the face read afterwards is one the recycle turned rather than one the pose
// supplied.
//
// The stock is posed EMPTY, by `openTable`, because that is the precondition the
// rule names. A turn of a stock that still holds cards is
// `stock/no-recycle-with-cards`, and what the recycle leaves behind on the waste is
// `stock/recycle-clears-waste` and `stock/recycle-clears-sets`.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import {
  captureStill,
  card,
  createHarness,
  FOUR,
  NINE,
  openTable,
  poseWaste,
  TWO,
  up,
  type Harness,
} from "../harness";
import { cardText } from "./turning";

/**
 * The waste the recycle takes back: three face-up cards under two sets. Which cards
 * they are decides nothing; the recycle reads no rank and no suit. Their faces are
 * stated rather than left to the pose, because the face is what is read afterwards.
 */
const POSED_WASTE = [
  up(card("clubs", TWO)),
  up(card("diamonds", NINE)),
  up(card("spades", FOUR)),
];
const POSED_SETS = [1, 2] as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("returns every waste card to the stock, face-down", async () => {
  openTable(h);
  const ids = poseWaste(h, POSED_WASTE, POSED_SETS);

  h.debug.turnStock();
  const after = h.snapshot();

  await h.advance(1);
  captureStill(h, "recycled");

  assertLength(
    after.stock,
    POSED_WASTE.length,
    "cards on the stock after a turn of an empty stock recycled the waste " +
      "(specs/stock.md)",
  );
  assertDeepEqual(
    after.stock.map((reported) => reported.id).sort((a, b) => a - b),
    [...ids].sort((a, b) => a - b),
    "the ids the recycled stock holds, which are the cards that were on the " +
      "waste (specs/stock.md)",
  );
  for (const reported of after.stock) {
    assertEqual(
      reported.faceUp,
      false,
      `the face of the ${cardText(reported)} the recycle returned to the ` +
        "stock (specs/stock.md)",
    );
  }
});
