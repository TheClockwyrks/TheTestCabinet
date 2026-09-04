// stock/empty-stock-recycles — a turn of an EMPTY stock returns every card on
// the waste to the stock, face-down.
//
// `specs/stock.md`: "A turn of an empty stock recycles instead: every card on
// the waste returns to the stock face-down, in reverse order ... The waste is
// left empty and its set memory is emptied with it."
//
// THIS POINT DECIDES THE STOCK SIDE ALONE: every card comes back, and every one
// of them is face-down. The order they come back in is
// `stock.recycle-preserves-order`, the emptied waste is `stock.recycle-clears-
// waste`, and the emptied memory is `stock.recycle-clears-sets`, so a build that
// recycles the cards but leaves them face-up loses exactly this point.
//
// EVERY CARD IS READ BY IDENTITY rather than by count. `specs/instrumentation.md`
// gives every card an id it keeps "for as long as it is on the table, across
// every move, turn, flip, and recycle", so a build that recycled six cards by
// dealing six fresh ones reads as six ids that were never on the waste. The
// cards are distinct, so a build that duplicated one and dropped another reads
// as a different multiset too.
//
// THE STOCK IS POSED EMPTY BY `openTable`, which is the whole precondition the
// recycle turns on: `specs/stock.md` recycles only when the stock holds nothing,
// and `stock.no-recycle-with-cards` is the point that holds the other side of it.
//
// THE MEMORY THE WASTE CARRIES IS SIZED TO THE BUILD'S OWN TURN COUNT, counted
// back from its top card, so the board is one the build's own turns could have
// left behind.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertLength } from "../assert";
import {
  captureStill,
  cards,
  createHarness,
  facesOf,
  openTable,
  poseWaste,
  type Harness,
} from "../harness";
import { turnCount, turnSets } from "./turns";

/** The waste, bottom card first, all distinct so identity is readable. */
const WASTE = ["2C", "3D", "4S", "5H", "6C", "7D"];

/** One frame, so the still carries the stock the recycle refilled. */
const DRAW_FRAMES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("returns every waste card to the stock, face-down", async () => {
  await openTable(h);
  const count = turnCount(await h.snapshot());
  const ids = await poseWaste(
    h,
    cards(...WASTE),
    turnSets(WASTE.length, count),
  );

  await h.debug.turnStock();
  await h.advance(DRAW_FRAMES);
  await captureStill(h, "recycled");

  const after = await h.snapshot();
  assertLength(
    after.stock,
    WASTE.length,
    `the cards on the stock after turning an empty stock over a waste of ` +
      `${WASTE.length} — specs/stock.md: every card on the waste returns to ` +
      "the stock",
  );
  assertDeepEqual(
    [...after.stock.map((c) => c.id)].sort((a, b) => a - b),
    [...ids].sort((a, b) => a - b),
    "the ids of the cards on the stock after the recycle, in order — a card " +
      "keeps its id across a recycle (specs/instrumentation.md), so these " +
      "are the very cards that were on the waste rather than a fresh deal",
  );
  assertDeepEqual(
    facesOf(after.stock),
    after.stock.map(() => false),
    "the face of every card the recycle put back, as `false` for face-down " +
      "— specs/stock.md: every card on the waste returns to the stock " +
      "face-down",
  );
});
