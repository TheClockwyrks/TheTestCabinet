// instrumentation/clear-pile — one pile is emptied and the other twelve stand.
//
// THE RULE. specs/instrumentation.md, under The cards: "`clearPile(pile, index)`
// — Removes every card from the named pile", and "`clearPile` leaves the other
// twelve piles standing." It is how a scenario clears the ground it needs
// without disturbing the rest of the board it has already posed, so a build
// that empties the neighbours with it, or that empties the wrong pile, breaks
// every scenario built that way.
//
// THE BOARD CARRIES SOMETHING IN ALL THIRTEEN PILES, so there is a reading to
// spoil everywhere: the stock, the waste with its set memory, four started
// foundations and seven columns. A build that swept the whole tableau reads
// seven empty columns; one that emptied the wrong column reads the named one
// still full; one that emptied everything reads thirteen empty piles. Each is a
// different failure and each names itself.
//
// THE SURVIVORS ARE COMPARED BY IDENTITY, not by count: every card is held to
// the id, suit, rank and face it carried before the call, so a build that
// rebuilt an untouched pile out of fresh cards fails as well
// (specs/instrumentation.md, Identity).
//
// BOTH HALVES OF THE RULE ARE READ HERE. specs/instrumentation.md adds that "on
// the waste it also empties the waste's set memory", so the operation has two
// effects and this is the point that quotes both: a COLUMN is cleared first and
// the waste's memory must be untouched, and then the WASTE is cleared and its
// memory must go with its cards. No other point calls `clearPile` on the waste —
// `stock/recycle-clears-sets` decides the recycle, which is a different operation
// — so both halves are read here or nowhere.
//
// WHAT IT DOES NOT DECIDE. That `clearTable` empties all thirteen is
// `instrumentation/clear-table`.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertLength } from "../assert";
import {
  ACE,
  captureStill,
  card,
  COLUMNS,
  createHarness,
  EIGHT,
  FIVE,
  FOUNDATIONS,
  FOUR,
  JACK,
  NINE,
  openTable,
  PileKind,
  pileOf,
  poseColumn,
  poseFoundation,
  poseStock,
  poseWaste,
  QUEEN,
  SEVEN,
  SIX,
  TEN,
  THREE,
  TWO,
  type CascadeSnapshot,
  type Harness,
} from "../harness";

/** The column emptied. */
const CLEARED_COLUMN = 2;

/** The three cards the waste holds, under two sets. */
const WASTE_CARDS = [
  card("hearts", TWO),
  card("clubs", FOUR),
  card("spades", SIX),
];
const WASTE_SETS = [1, 2];

/** The two cards the stock holds. */
const STOCK_CARDS = [card("diamonds", THREE), card("clubs", FIVE)];

/** A card for each of the seven columns, so every column has something to lose. */
const COLUMN_CARDS = [
  card("spades", SEVEN),
  card("hearts", EIGHT),
  card("clubs", NINE),
  card("diamonds", TEN),
  card("spades", JACK),
  card("hearts", QUEEN),
  card("clubs", THREE),
];

/** Every pile and index the board carries, so the reading walks all thirteen. */
const PILES: readonly { pile: PileKind; index: number }[] = [
  { pile: "stock", index: 0 },
  { pile: "waste", index: 0 },
  ...FOUNDATIONS.map((index) => ({ pile: "foundation" as PileKind, index })),
  ...COLUMNS.map((index) => ({ pile: "tableau" as PileKind, index })),
];

/** One pile as identity, face and order — everything an untouched pile keeps. */
function pileIdentity(
  snapshot: CascadeSnapshot,
  pile: PileKind,
  index: number,
): unknown[] {
  return pileOf(snapshot, pile, index).map((entry) => ({
    id: entry.id,
    suit: entry.suit,
    rank: entry.rank,
    faceUp: entry.faceUp,
  }));
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("empties the named pile and leaves the other twelve holding what they held", async () => {
  openTable(h);
  poseStock(h, STOCK_CARDS);
  poseWaste(h, WASTE_CARDS, WASTE_SETS);
  poseFoundation(h, 0, "spades", ACE);
  poseFoundation(h, 1, "hearts", ACE);
  poseFoundation(h, 2, "diamonds", ACE);
  poseFoundation(h, 3, "clubs", ACE);
  for (const column of COLUMNS) poseColumn(h, column, [COLUMN_CARDS[column]]);

  const before = h.snapshot();

  h.debug.clearPile("tableau", CLEARED_COLUMN);
  const after = h.snapshot();

  await h.advance(1);
  captureStill(h, "board");

  assertLength(
    pileOf(after, "tableau", CLEARED_COLUMN),
    0,
    `cards left on column ${CLEARED_COLUMN}, the pile clearPile named: it ` +
      "removes every card from it (specs/instrumentation.md)",
  );

  for (const { pile, index } of PILES) {
    if (pile === "tableau" && index === CLEARED_COLUMN) continue;
    assertDeepEqual(
      pileIdentity(after, pile, index),
      pileIdentity(before, pile, index),
      `the ${pile} pile ${index} after clearPile emptied column ` +
        `${CLEARED_COLUMN}: clearPile leaves the other twelve piles standing ` +
        "(specs/instrumentation.md)",
    );
  }

  assertDeepEqual(
    after.wasteSets,
    before.wasteSets,
    "the waste's set memory after a COLUMN was cleared: the waste is one of " +
      "the twelve piles left standing (specs/instrumentation.md)",
  );
});
