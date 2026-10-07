// stock/turns — the arithmetic and the two drives this group's points share.
// CASE-PROVIDED.
//
// EVERY POINT IN THIS GROUP IS COMMON TO BOTH VARIANTS, so none of them may
// write a turn count. `specs/stock.md` fixes `TURN_COUNT` per deal mode — `1`
// under Draw One, `3` under Draw Three — and those two figures live in
// `draw-one/constants.ts` and `draw-three/constants.ts`, where
// `deal-mode-reported` pins the build's own reading of them to the
// specification. A common point sizes itself to the build's `turnCount` instead,
// through {@link turnCount} below, and so holds the build to whatever mode it
// says it is playing.
//
// NOTHING HERE ASSERTS A REQUIREMENT, and nothing here carries a tolerance. Each
// helper fails only when the scenario its caller asked for was never reached —
// a turn count no deal mode of this case has, a stock that would not empty — and
// then with what was wanted named.

import { fail } from "../assert";
import { DECK_SIZE } from "../constants";
import {
  cardKey,
  type CardView,
  type CascadeSnapshot,
  type Harness,
} from "../harness";

/**
 * The turn count the build reports, checked against what the caller's scenario
 * can carry.
 *
 * `specs/stock.md` gives a turn a count of at least one card and at most a
 * deck's worth, so a reading outside that is a build whose deal mode is not one
 * this case defines and a scenario that cannot be driven. A point whose drive
 * needs a WHOLE turn to fit on the stock it posed passes that stock's depth as
 * `atMost`, and a point that only sizes a posed set memory leaves it at the deck.
 *
 * It is reported rather than quietly clamped: a clamp would grade a build
 * against a figure it never claimed.
 */
export function turnCount(
  snapshot: CascadeSnapshot,
  atMost = DECK_SIZE,
): number {
  const count = snapshot.turnCount;
  if (!Number.isInteger(count) || count < 1 || count > atMost) {
    fail(
      `a turn count of at least 1 and at most the ${atMost} card(s) this ` +
        "scenario can carry — specs/stock.md fixes TURN_COUNT at 1 under " +
        "Draw One and 3 under Draw Three",
      count,
    );
  }
  return count;
}

/**
 * The set memory a waste of `total` cards carries when the turns that filled it
 * moved `count` cards apiece, OLDEST SET FIRST.
 *
 * The sets are counted back from the waste's top card, the turn count at a time,
 * so a waste of seven filled by turns of three carries `[1, 3, 3]`: the oldest
 * set is the short one, because it is the one the count did not reach. That is
 * the memory `specs/stock.md` describes, and it is what a posed waste in this
 * group is given so that no point rests on a memory a turn could never have
 * produced.
 */
export function turnSets(total: number, count: number): number[] {
  const sets: number[] = [];
  for (let left = total; left > 0; left -= count) {
    sets.push(Math.min(count, left));
  }
  return sets.reverse();
}

/** The suit-and-rank key of every card in a pile, in the pile's own order. */
export function keysOf(
  pile: readonly Pick<CardView, "suit" | "rank">[],
): string[] {
  return pile.map((c) => cardKey(c));
}

/**
 * Turn the stock until it holds nothing, and hand back how many turns that took.
 *
 * It stops the moment the stock is empty, so it never turns an empty stock and
 * never recycles: the recycle is its own event and its own points. `between` is
 * run after each turn, which is where a point that is recording a replay holds
 * the frame it just reached.
 *
 * It fails when `maxTurns` turns left cards on the stock, which is a build whose
 * turn moves nothing rather than a build that got the count wrong.
 */
export async function drainStock(
  h: Harness,
  maxTurns: number,
  between?: () => Promise<void>,
): Promise<number> {
  let turns = 0;
  while (turns <= maxTurns) {
    if ((await h.snapshot()).stock.length === 0) return turns;
    await h.debug.turnStock();
    turns += 1;
    if (between !== undefined) await between();
  }
  fail(
    `the stock to empty within ${maxTurns} turns, each of them moving at ` +
      "least one card onto the waste (specs/stock.md)",
    `${(await h.snapshot()).stock.length} card(s) still on the stock`,
  );
}
