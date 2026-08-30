// stock/turn-drains-stock — turning until the stock is empty puts every card on
// the waste exactly once, none lost and none duplicated.
//
// `specs/stock.md` fixes both halves of that: a turn "moves `TURN_COUNT` cards
// onto the waste, or all that remain when the stock holds fewer than that", and
// the cards are "taken" from the stock, so a card that arrives on the waste has
// left the stock. Drive it to the end and the accounting has to close: the stock
// empty, the waste holding the whole pile, and every card there once.
//
// WHAT A SINGLE TURN CANNOT CATCH, AND THIS DOES. A build that leaves the card
// it turned on the stock as well as on the waste, a build that drops the last
// card of a group, and a build that turns the same card twice all keep the right
// count for a while and lose it over a whole pass. The cards are distinct and
// every one of them is read by identity, so each of those reads as a different
// multiset.
//
// TWELVE CARDS IS A WHOLE NUMBER OF TURNS UNDER EITHER DEAL MODE — twelve turns
// under Draw One, four under Draw Three — so the pass ends with an exactly
// emptied stock and the short-turn rule is out of the way; that rule is
// `draw-three/turn-remainder`'s.
//
// THE DRIVE STOPS AT THE EMPTY STOCK, so no recycle happens and this point reads
// the turn alone.

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
import { drainStock } from "./turns";

/** The stock, bottom card first: twelve distinct cards. */
const STOCK = [
  "2C",
  "3D",
  "4S",
  "5H",
  "6C",
  "7D",
  "8S",
  "9H",
  "10C",
  "JD",
  "QS",
  "KH",
];

/** One frame, so the still carries the waste holding the whole stock. */
const DRAW_FRAMES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("puts every card of the stock on the waste once", async () => {
  await openTable(h);
  const ids = await poseStock(h, faceDown(...STOCK));

  await drainStock(h, STOCK.length);
  await h.advance(DRAW_FRAMES);
  await captureStill(h, "drained");

  const after = await h.snapshot();
  assertLength(
    after.stock,
    0,
    `the cards left on the stock after turning it down from ${STOCK.length} ` +
      "— the drive stops the moment it reports empty, so anything here is a " +
      "turn that reported cards it had not moved (specs/stock.md)",
  );
  assertDeepEqual(
    [...after.waste.map((c) => c.id)].sort((a, b) => a - b),
    [...ids].sort((a, b) => a - b),
    "the ids of the cards on the waste once the stock is drained, in order " +
      "— every card the stock held, each of them exactly once. A repeated id " +
      "is a card turned twice and a missing one is a card lost " +
      "(specs/stock.md, specs/instrumentation.md on a card keeping its id)",
  );
  assertLength(
    after.waste,
    STOCK.length,
    "the cards on the waste once the stock is drained (specs/stock.md)",
  );
});
