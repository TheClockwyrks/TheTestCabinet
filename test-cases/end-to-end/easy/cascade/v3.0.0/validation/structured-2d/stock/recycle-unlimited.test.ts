// stock/recycle-unlimited — the stock may be gone through as often as the player
// likes.
//
// THE RULE. specs/stock.md: "Passes through the stock are unlimited, so a stock
// emptied and recycled any number of times behaves the same each time." Klondike
// deals that need a fourth look at the stock are ordinary, so a build that counted
// passes, or that degraded after the first recycle, would refuse the player a game
// that is still winnable.
//
// FOUR PASSES, EACH DRIVEN THROUGH THE GAME'S OWN TURN. Each pass turns the stock
// until it reports itself empty and keeps the waste it produced; the pass after it
// begins with the recycle. All four are compared against the FIRST, so a build that
// held up for two passes and then lost or reordered a card fails naming the pass it
// went wrong on rather than with a bare mismatch. A build that refused to recycle a
// second time fails on the pass that came back short.
//
// WHY THIS IS THE POINT'S OWN SCENARIO AND NOT `recycle-preserves-order` TWICE. That
// point decides one recycle's reversal; this one decides that the recycle is
// available again, and again, with the deck intact each time. A build can pass the
// first and fail this one, by counting passes or by consuming the memory it recycles
// through.
//
// THE STOCK IS DRAINED BY TURNING UNTIL IT REPORTS ITSELF EMPTY, never by dividing
// the pile by an assumed turn count, because that figure is the one thing the two
// deal modes differ in. Six cards divide evenly under both, so no pass ends on a
// short turn.
//
// The output is a REPLAY, because what it is evidence of is a sequence: four passes
// through the same six cards, a frame per turn, which a still frame of the last
// waste could not show. The recording holds a frame per turn of all four passes and
// nothing else — well inside the recorder's budget, and with no full-screen blit in
// it, since the painted layer belongs to the victory cascade alone.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertLength } from "../assert";
import {
  captureReplay,
  createHarness,
  openTable,
  poseStock,
  type Harness,
} from "../harness";
import { drainStock, stockSpecs } from "./turning";

/** Cards posed on the stock: six divides by both deal modes' turn counts. */
const STOCK_SIZE = 6;

/** How many times the stock is emptied and recycled. */
const PASSES = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("empties and recycles the stock four times over, turning the same cards each time", async () => {
  openTable(h);
  poseStock(h, stockSpecs(STOCK_SIZE));

  const passes = await captureReplay(h, "passes", async () => {
    const seen: number[][] = [];
    for (let pass = 0; pass < PASSES; pass += 1) {
      // Every pass after the first opens on an empty stock, so this turn is the
      // recycle that refills it (specs/stock.md).
      if (pass > 0) {
        h.debug.turnStock();
        await h.advance(1);
      }
      seen.push(await drainStock(h));
    }
    return seen;
  });

  for (const [pass, waste] of passes.entries()) {
    assertLength(
      waste,
      STOCK_SIZE,
      `cards pass ${pass + 1} of ${PASSES} put on the waste (specs/stock.md)`,
    );
    assertDeepEqual(
      waste,
      passes[0],
      `the ids pass ${pass + 1} of ${PASSES} turned onto the waste, bottom ` +
        "first, against the ids the first pass turned (specs/stock.md)",
    );
  }
});
