// draw-three/turn-remainder — a stock holding fewer than three cards turns them all.
//
// THE RULE. `specs/stock.md`: "A turn of a stock holding cards moves `TURN_COUNT`
// cards onto the waste, or all that remain when the stock holds fewer than that",
// and each turn "appends one set, holding exactly the cards that turn moved". So a
// stock holding two cards turns both, and the memory gains one set of two.
//
// THE EDGE CASE IS ITS OWN CHECK. `draw-three/turn-count` decides the ordinary
// turn of a stock with cards to spare; this one decides the short stock at the end
// of a pass, where a build that takes three cards unconditionally either fails
// outright or silently turns a card it does not have.
//
// THE POSE. Two face-down cards on the stock, one short of the turn count, and
// nothing anywhere else. The stock holds cards, so a turn of it turns rather than
// recycles (`specs/stock.md`) — the recycle is `stock.empty-stock-recycles` and is
// not what this point is about.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  faceDown,
  openTable,
  poseStock,
  type Harness,
} from "../harness";
import { TURN_COUNT } from "./constants";

/**
 * The short stock, bottom card first: one card fewer than a turn takes, face-down
 * as a card on the stock is (`specs/deal.md`).
 */
const STOCK = ["2H", "3D"];

/** The one set the turn appends, holding exactly the cards it moved. */
const SETS_AFTER = [STOCK.length];

/** One frame, so the still carries the board the reading was taken from. */
const SETTLE_FRAMES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("turns both cards of a two-card stock and remembers them as one set", async () => {
  await openTable(h);
  await poseStock(h, faceDown(...STOCK));

  await h.debug.turnStock();
  const after = await h.snapshot();
  await h.advance(SETTLE_FRAMES);
  await captureStill(h, "turn");

  assertLength(
    after.waste,
    STOCK.length,
    `cards a turn moved from a stock of ${STOCK.length}, which is fewer than ` +
      `the turn count of ${TURN_COUNT} (specs/stock.md)`,
  );
  assertLength(
    after.stock,
    0,
    "cards left on the stock: a short turn takes all that remain " +
      "(specs/stock.md)",
  );
  assertDeepEqual(
    after.wasteSets,
    SETS_AFTER,
    "the waste's set memory after the short turn, which appends one set " +
      "holding exactly the cards that turn moved (specs/stock.md)",
  );
});
