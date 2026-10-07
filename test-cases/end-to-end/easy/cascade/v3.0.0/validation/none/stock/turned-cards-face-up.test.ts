// stock/turned-cards-face-up — every card a turn puts on the waste is face-up.
//
// `specs/stock.md`: the cards "are taken one at a time from the top of the stock
// and placed face-up on the waste". A card on the stock is face-down
// (`specs/deal.md`), so the turn is the moment each of these cards is turned
// over, and a build that moved them without turning them leaves a waste that
// draws card backs and offers a player nothing to read.
//
// THE WASTE STARTS EMPTY, which is what makes the reading a reading of the
// turn's own cards: every card on the waste afterwards is one the turn put
// there, so "every card the turn put on the waste" needs no bookkeeping to
// identify. The stock is posed face-down, as `specs/deal.md` has it, so a
// face-up card on the waste can only have been turned over by the turn.
//
// IT IS ONE DIRECTION OF ONE RULE. How many cards arrived is
// `stock.turn-moves-to-waste`; which order they arrived in is `stock.turn-order`.
// This point reads their faces alone, and asks first that the turn moved
// something at all so the reading is not vacuous.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertGreaterThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  faceDown,
  facesOf,
  openTable,
  poseStock,
  type Harness,
} from "../harness";

/** The stock, bottom card first, face-down as `specs/deal.md` leaves it. */
const STOCK = ["2C", "3D", "4S", "5H", "6C", "7D"];

/** One frame, so the still carries the face-up cards the turn brought over. */
const DRAW_FRAMES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("places every card it turns face-up on the waste", async () => {
  await openTable(h);
  await poseStock(h, faceDown(...STOCK));

  await h.debug.turnStock();
  await h.advance(DRAW_FRAMES);
  await captureStill(h, "turned");

  const after = await h.snapshot();
  assertGreaterThanOrEqual(
    after.waste.length,
    1,
    "cards on the waste after a turn of a stock holding " +
      `${STOCK.length} — specs/stock.md: a turn of a stock holding cards ` +
      "moves at least one of them onto the waste",
  );
  assertDeepEqual(
    facesOf(after.waste),
    after.waste.map(() => true),
    "the face of every card the turn put on the waste, as `true` for " +
      "face-up — specs/stock.md: the cards are placed face-up on the waste, " +
      "and they were face-down on the stock (specs/deal.md)",
  );
});
