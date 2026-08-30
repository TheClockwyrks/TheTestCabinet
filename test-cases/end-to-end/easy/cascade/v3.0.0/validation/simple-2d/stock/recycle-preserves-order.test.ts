// stock/recycle-preserves-order — the second pass deals the first pass again.
//
// THE RULE. specs/stock.md: "every card on the waste returns to the stock face-down,
// in reverse order, so the card that lay at the bottom of the waste is the stock's
// top card and a further pass turns the same cards up in the same order." The
// reversal is what makes a pass through the stock repeatable, and repeatability is
// what makes Klondike a game of planning: a player who has seen a pass knows what
// the next one holds.
//
// THE CLAIM IS READ AS THE SPECIFICATION STATES IT, from the player's side. Rather
// than asserting the stock's internal order after the recycle, which would only
// restate the sentence's middle clause, the check DRIVES the second pass and
// compares the waste it produces against the waste the first pass produced. Every
// wrong reversal reads as a different sequence: a build that returned the waste
// without reversing it deals its cards back in mirrored order, and a build that
// shuffled the recycled stock deals them back in no order at all.
//
// THE STOCK IS DRAINED BY TURNING UNTIL IT REPORTS ITSELF EMPTY, never by dividing
// the pile by an assumed turn count: the size of a turn is the one figure the two
// deal modes differ in and this point is common to both. Six cards divide evenly
// under either mode, so neither pass ends on a short turn; the short turn is
// `draw-three.turn-remainder`.
//
// Cards are compared by id, which a card keeps for as long as it is on the table
// (specs/instrumentation.md), so what is read is that the same CARDS came up in the
// same places rather than that two sequences of ranks happened to match.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  openTable,
  poseStock,
  type Harness,
} from "../harness";
import { drainStock, stockSpecs } from "./turning";

/**
 * Cards posed on the stock: six, which divides by both deal modes' turn counts, so
 * every turn in both passes is a full one.
 */
const STOCK_SIZE = 6;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("turns the same cards up in the same order after a recycle", async () => {
  openTable(harness);
  poseStock(harness, stockSpecs(STOCK_SIZE));

  const first = await drainStock(harness);
  assertLength(
    first,
    STOCK_SIZE,
    "cards the first pass through the stock put on the waste " +
      "(specs/stock.md)",
  );

  // The stock is empty now, so this turn is the recycle itself.
  harness.debug.turnStock();
  const second = await drainStock(harness);

  await harness.advance(1);
  captureStill(harness, "turned");

  assertDeepEqual(
    second,
    first,
    "the ids the pass after a recycle turns onto the waste, bottom first, " +
      "against the ids the pass before it turned (specs/stock.md)",
  );
});
