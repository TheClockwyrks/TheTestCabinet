// stock/turn-moves-to-waste — a turn carries the deal mode's cards across.
//
// THE RULE. specs/stock.md: "A turn of a stock holding cards moves `TURN_COUNT`
// cards onto the waste". So one turn of a stock that holds more than it needs
// leaves the stock exactly that many cards shorter and the waste exactly that many
// cards longer.
//
// THE FIGURE IS THE BUILD'S OWN `turnCount`, NOT A LITERAL. `TURN_COUNT` is the one
// figure the two deal modes differ in, and this point is common to both, so what it
// decides is the RELATION between the turn count the build reports and what its turn
// did. The literal behind that figure is pinned separately, by `draw-one.turn-count`
// and `draw-three.turn-count` for the size of a turn and by the two
// `deal-mode-reported` points for the number the build reports. A build that turns
// three cards under Draw One fails those points; a build whose turn disagrees with
// the count it reports fails this one.
//
// THE STOCK IS POSED LONG. Twelve cards, comfortably more than either deal mode's
// turn, so the remainder rule ("or all that remain when the stock holds fewer than
// that") is not in play here and a short turn is not mistaken for a correct one. The
// remainder itself is `draw-three.turn-remainder`.
//
// WHAT IS NOT READ HERE. Which cards moved and in what order is `stock/turn-order`,
// their faces are `stock/turned-cards-face-up`, and the set the turn appends is
// `stock/turn-starts-a-set`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  openTable,
  poseStock,
  type Harness,
} from "../harness";
import { stockSpecs } from "./turning";

/**
 * Cards posed on the stock before the turn.
 *
 * Twelve is longer than either deal mode's turn and divides by both, so the turn
 * under test takes a whole turn's worth and leaves a stock still holding plenty.
 */
const STOCK_SIZE = 12;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("moves the reported turn count off the stock and onto the waste", async () => {
  openTable(h);
  poseStock(h, stockSpecs(STOCK_SIZE));

  const before = h.snapshot();
  h.debug.turnStock();
  const after = h.snapshot();

  await h.advance(1);
  captureStill(h, "turned");

  const moved = before.stock.length - after.stock.length;

  // A turn moves cards: `TURN_COUNT` is one under Draw One and three under Draw
  // Three (specs/stock.md), so a turn that moved nothing is no turn at all.
  assertGreaterThanOrEqual(
    moved,
    1,
    "cards a turn of a twelve-card stock takes off the stock (specs/stock.md)",
  );
  assertEqual(
    after.waste.length,
    before.waste.length + moved,
    "cards on the waste after a turn, the empty waste plus what the stock lost " +
      "(specs/stock.md)",
  );
  assertEqual(
    moved,
    after.turnCount,
    "cards a turn moved, against the turnCount the build reports " +
      "(specs/stock.md)",
  );
});
