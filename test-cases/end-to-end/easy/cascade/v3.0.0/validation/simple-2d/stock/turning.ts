// stock/turning — the stock this group turns, and the draining loop three of its
// checks share.
//
// LOCAL TO THIS GROUP. Nothing outside `validation/simple-2d/stock/` imports it, so
// it lives here rather than in the shared harness. It is scenario arrangement and
// nothing else: it holds no threshold and no figure the specification fixes, and
// every number a check asserts is stated in the check that asserts it.
//
// WHY A LOOP RATHER THAN A COUNT OF TURNS. specs/stock.md gives a turn's size as
// `TURN_COUNT`, which is the one figure the two deal modes differ in, and the plan
// is explicit that a common check never hard-codes it: `draw-one.turn-count` and
// `draw-three.turn-count` are the points that pin the figure. So a check that wants
// a drained stock turns until the stock reports itself empty rather than dividing a
// pile size by a number it assumed. The loop is bounded by `DECK_SIZE`, because a
// turn of a stock holding cards moves at least one card off it (specs/stock.md), so
// a fifty-two card stock cannot survive fifty-two turns; a build whose turn moves
// nothing fails here rather than hanging the suite.

import { DECK_SIZE } from "../../src/constants";
import { fail } from "../assert";
import type { Harness } from "../harness";

/**
 * Distinct cards to pose a stock from, in the order {@link stockSpecs} takes them.
 *
 * Thirteen spades and thirteen hearts, so a posed stock of any size this group asks
 * for holds no card twice and a check comparing ids against specs is never confused
 * by a duplicate. Which cards they are decides nothing: the stock is face-down and
 * no rule in specs/stock.md reads a card's rank or suit.
 */
const POOL: readonly string[] = [
  "AS",
  "2S",
  "3S",
  "4S",
  "5S",
  "6S",
  "7S",
  "8S",
  "9S",
  "10S",
  "JS",
  "QS",
  "KS",
  "AH",
  "2H",
  "3H",
  "4H",
  "5H",
  "6H",
  "7H",
  "8H",
  "9H",
  "10H",
  "JH",
  "QH",
  "KH",
];

/**
 * `count` distinct face-down cards, bottom card first, for {@link poseStock}.
 *
 * Face-down because that is what the stock holds (specs/deal.md), which is what
 * makes `stock/turned-cards-face-up` a reading of the turn rather than of the pose.
 *
 * A `count` past the pool is a fault in the check rather than in the build, so it
 * throws a plain error.
 */
export function stockSpecs(count: number): string[] {
  if (count > POOL.length) {
    throw new Error(
      `cascade: stock/turning holds ${POOL.length} distinct cards and was ` +
        `asked for ${count}`,
    );
  }
  return POOL.slice(0, count).map((spec) => `#${spec}`);
}

/**
 * Turn the stock until it holds nothing, and report the waste's ids, bottom first.
 *
 * One frame is run after each turn, so a check recording a replay has a frame per
 * turn to show and every check watches the same sequence. A frame changes no pile:
 * Cascade moves only when something moves it (specs/controls.md).
 *
 * It stops when the stock reports itself empty, so it never turns an empty stock and
 * never recycles. A check that wants the recycle calls `turnStock` itself afterwards.
 */
export async function drainStock(h: Harness): Promise<number[]> {
  for (let turn = 0; turn < DECK_SIZE; turn += 1) {
    if (h.snapshot().stock.length === 0) {
      return h.snapshot().waste.map((card) => card.id);
    }
    h.debug.turnStock();
    await h.advance(1);
  }
  return fail(
    `turnStock() to empty the stock within ${DECK_SIZE} turns: a turn of a ` +
      "stock holding cards moves cards off it (specs/stock.md)",
    h.snapshot().stock.length,
  );
}
