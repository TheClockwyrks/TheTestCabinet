// stock/turning — the stock this group turns, the cards it turns, and the draining
// loop three of its checks share.
//
// LOCAL TO THIS GROUP. Nothing outside `validation/structured-2d/stock/` imports it,
// so it lives here rather than in the shared harness. It is scenario arrangement and
// nothing else: it holds no threshold and no figure the specification fixes, and
// every number a check asserts is stated in the check that asserts it.
//
// WHY A LOOP RATHER THAN A COUNT OF TURNS. specs/stock.md gives a turn's size as
// `TURN_COUNT`, which is the one figure the two deal modes differ in, and a check
// common to both never hard-codes it: `draw-one.turn-count` and
// `draw-three.turn-count` are the points that pin the figure. So a check that wants
// a drained stock turns until the stock reports itself empty rather than dividing a
// pile size by a number it assumed. The loop is bounded by `DECK_SIZE`, because a
// turn of a stock holding cards moves at least one card off it (specs/stock.md), so
// a fifty-two card stock cannot survive fifty-two turns; a build whose turn moves
// nothing fails here rather than hanging the suite.

import { DECK_SIZE } from "../../src/constants";
import { fail } from "../assert";
import {
  card,
  down,
  type CardSpec,
  type Harness,
  type SnapshotCard,
  type Suit,
} from "../harness";

/**
 * Distinct cards to pose a stock from, in the order {@link stockSpecs} takes them.
 *
 * Thirteen spades and thirteen hearts, so a posed stock of any size this group asks
 * for holds no card twice and a check comparing ids against what it posed is never
 * confused by a duplicate. Which cards they are decides nothing: the stock is
 * face-down and no rule in specs/stock.md reads a card's rank or suit.
 */
const POOL: readonly CardSpec[] = ["spades", "hearts"].flatMap((suit) =>
  Array.from({ length: 13 }, (_, i) => card(suit as Suit, i + 1)),
);

/**
 * `count` distinct face-down cards, bottom card first, for `poseStock`.
 *
 * Face-down because that is what the stock holds (specs/deal.md), which is what
 * makes `stock/turned-cards-face-up` a reading of the turn rather than of the pose.
 * The face is stated here rather than left to the pose's default, so the arrangement
 * says what it is.
 *
 * A `count` past the pool is a fault in the check rather than in the build, so it
 * throws a plain error.
 */
export function stockSpecs(count: number): CardSpec[] {
  if (count > POOL.length) {
    throw new Error(
      `cascade: stock/turning holds ${POOL.length} distinct cards and was ` +
        `asked for ${count}`,
    );
  }
  return POOL.slice(0, count).map(down);
}

/** The rank names a deck is read by, Ace low to King high (specs/deal.md). */
const RANK_TEXT: readonly string[] = [
  "A",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "J",
  "Q",
  "K",
];

/** The one letter each suit is written as. */
const SUIT_TEXT: Readonly<Record<Suit, string>> = {
  spades: "S",
  hearts: "H",
  diamonds: "D",
  clubs: "C",
};

/**
 * One reported card written out — its rank and its suit — so a failure names the
 * card it is about rather than an id a reviewer cannot place. A rank or suit outside
 * the deck is printed as it was reported rather than hidden.
 */
export function cardText(reported: SnapshotCard): string {
  const rank = RANK_TEXT[reported.rank - 1] ?? String(reported.rank);
  const suit = SUIT_TEXT[reported.suit] ?? String(reported.suit);
  return `${rank}${suit}`;
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
      return h.snapshot().waste.map((reported) => reported.id);
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
