// Cascade — draw-three/turn-remainder: a stock holding fewer than three turns all that remain.
//
// specs/stock.md: "A turn of a stock holding cards moves `TURN_COUNT` cards onto
// the waste, or all that remain when the stock holds fewer than that." Each turn
// then "appends one set, holding exactly the cards that turn moved" — so a turn
// of a two-card stock moves two and records a set of two, not a set of three and
// not a set of one.
//
// This is the edge case Draw Three has and Draw One does not: a Draw One stock
// never holds fewer than its turn count while it holds anything at all. It is its
// own point so a failed grade names the short turn rather than the turn count.
//
// The stock is posed with exactly two cards and the waste is left empty, which is
// the smallest arrangement that separates every wrong model: a build that insists
// on three leaves the stock holding two and the waste empty, one that turns one
// leaves one behind, one that treated the short stock as empty recycles instead
// and leaves the stock holding two, and one that records the turn count rather
// than the cards it moved records a set of three over a waste of two.
//
// specs/stock.md is explicit that a turn of a stock that holds cards never
// recycles, so the two cards must arrive on the waste.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  JACK,
  TEN,
  captureStill,
  card,
  createHarness,
  openTable,
  poseStock,
  type Harness,
} from "../harness";

/**
 * The cards left on the stock, bottom first.
 *
 * Two: fewer than the `TURN_COUNT` of `3` specs/stock.md fixes for this variant,
 * and more than one, so a build that turned a single card is told apart from one
 * that turned all that remained.
 */
const REMAINDER = [card("spades", TEN), card("hearts", JACK)];

/** The set specs/stock.md requires the turn to append: exactly the cards it moved. */
const EXPECTED_SETS = [REMAINDER.length];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("turns both cards of a two-card stock and records a set of two", async () => {
  openTable(h);
  poseStock(h, REMAINDER);

  h.debug.turnStock();

  await h.drawFrame();
  captureStill(h, "turn");

  const after = h.snapshot();
  assertEqual(after.stock.length, 0, "cards left on the short stock");
  assertEqual(
    after.waste.length,
    REMAINDER.length,
    "cards the short turn put on the waste",
  );
  assertDeepEqual(after.wasteSets, EXPECTED_SETS, "the waste's set memory");
});
