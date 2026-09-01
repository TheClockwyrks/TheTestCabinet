// stock/turn-drains-stock — turning moves the stock across whole.
//
// THE RULE. specs/stock.md: a turn "moves `TURN_COUNT` cards onto the waste, or all
// that remain when the stock holds fewer than that". Turn after turn, that adds up
// to one claim about the pass as a whole: every card the stock held reaches the
// waste, each exactly once, and the stock is left empty. A build that dropped a card
// on the way, or that copied one across, has changed the deck itself, and every
// later pass would deal a deck that is not the one the game was dealt.
//
// THE PASS IS DRIVEN TURN BY TURN UNTIL THE STOCK REPORTS ITSELF EMPTY, never by
// dividing the pile by an assumed turn count: the size of a turn is the one figure
// the two deal modes differ in, and this point is common to both. Twelve cards
// divide by either mode's turn, so no turn in the pass is a short one; the short
// turn is `draw-three.turn-remainder`. The loop is bounded, so a build whose turn
// moves nothing fails here rather than running forever.
//
// THE CARDS ARE COMPARED AS A SORTED SET OF IDS, because what is decided here is
// that none was lost and none duplicated; the ORDER they arrive in is
// `stock/turn-order` for one turn and `stock/recycle-preserves-order` across a
// recycle. An id is a card's own identity for as long as it is on the table
// (specs/instrumentation.md), so a build that put a second copy of one card on the
// waste reports a repeated id and fails, where a comparison of ranks and suits could
// not tell the copy from the original.

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
 * Cards posed on the stock: twelve, which divides by both deal modes' turn counts,
 * and long enough that a pass takes several turns under either.
 */
const STOCK_SIZE = 12;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("puts every card of the stock on the waste once and leaves the stock empty", async () => {
  openTable(harness);
  const posed = poseStock(harness, stockSpecs(STOCK_SIZE));

  const waste = await drainStock(harness);

  await harness.advance(1);
  captureStill(harness, "drained");

  const after = harness.snapshot();
  assertLength(
    after.stock,
    0,
    "cards left on the stock once it has been turned until it reported itself " +
      "empty (specs/stock.md)",
  );
  assertLength(
    waste,
    STOCK_SIZE,
    "cards on the waste once the whole stock has been turned (specs/stock.md)",
  );
  assertDeepEqual(
    [...waste].sort((a, b) => a - b),
    [...posed].sort((a, b) => a - b),
    "the ids the waste holds after the pass, which are the stock's own cards, " +
      "each of them once (specs/stock.md)",
  );
});
