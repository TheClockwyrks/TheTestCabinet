// deal/reshuffled — a new game is dealt from a deck shuffled afresh.
//
// THE RULE. specs/deal.md: "Every new game deals from a full deck shuffled
// uniformly at random, so every ordering of the fifty-two cards is as likely as any
// other and each new game is dealt afresh." A build that lays the same board out
// every time satisfies every other item in this group and is not the game: a
// solitaire whose deal is fixed is one puzzle played over and over.
//
// HOW IT IS OBSERVED. The shuffle is random, so nothing about ONE deal can be
// asserted; what is observable is that two deals differ. specs/instrumentation.md
// makes that observable exactly: `reset(options)` takes an `options.seed` that
// seeds all of the game's randomness, the deal's shuffle named among it, so two
// resets under two different seeds followed by two deals produce two draws from the
// shuffle, and a build whose deal is fixed produces the same board twice.
//
// WHAT COUNTS AS DIFFERENT is the arrangement of the seven columns: every column's
// cards in order, faces included. A build that shuffled only the stock and dealt a
// fixed tableau is caught, which a comparison over the whole table would let
// through only if it also fixed the stock.
//
// THE COLLISION THIS COULD SUFFER IS NOT REAL. A conformant build draws each board
// uniformly from `52!` orderings, so two draws landing on the same tableau has
// probability on the order of `1e-68`. No tolerance is stated because there is
// nothing to soften: the two boards are equal or they are not.

import { afterEach, beforeEach, it } from "vitest";
import { DEFAULT_SEED } from "../../src/constants";
import { assertNotEqual } from "../assert";
import {
  captureStill,
  cardKey,
  COLUMNS,
  createHarness,
  openTable,
  pileOf,
  type Harness,
} from "../harness";

/**
 * The two seeds the two deals run under. Any two distinct numbers serve: what the
 * item asserts is that a different seed produces a different board, and neither
 * value carries a meaning of its own. `DEFAULT_SEED` is the seed a build starts
 * from, and its neighbour is the other, so a build that reads the seed at all is
 * asked for nothing exotic.
 */
const SEED_A = DEFAULT_SEED;
const SEED_B = DEFAULT_SEED + 1;

/** Reset under `seed`, deal, and write the seven columns out as one line. */
function dealUnder(h: Harness, seed: number): string {
  openTable(h, seed);
  h.debug.deal();
  const dealt = h.snapshot();
  return COLUMNS.map((column) =>
    pileOf(dealt, "tableau", column)
      .map((card) => `${cardKey(card)}${card.faceUp ? "+" : "-"}`)
      .join(" "),
  ).join(" | ");
}

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("deals a different board from a different seed", async () => {
  const first = dealUnder(harness, SEED_A);
  await harness.advance(1);

  const second = dealUnder(harness, SEED_B);
  await harness.advance(1);
  // The second of the two boards, which is the one on the canvas: a still holds
  // one frame, and the failure below carries the first board's cards as text.
  captureStill(harness, "deals");

  assertNotEqual(
    second,
    first,
    `the columns dealt under seed ${SEED_B} to differ from the columns dealt ` +
      `under seed ${SEED_A} (specs/deal.md)`,
  );
});
