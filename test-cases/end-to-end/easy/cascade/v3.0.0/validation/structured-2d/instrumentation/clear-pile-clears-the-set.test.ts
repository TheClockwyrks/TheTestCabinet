// instrumentation/clear-pile-clears-the-set — `clearPile` on the waste empties
// its set memory as well as its cards, and leaves the other twelve piles
// standing.
//
// THE RULE. specs/instrumentation.md: "`clearPile` leaves the other twelve
// piles standing. On the waste it also empties the waste's set memory."
//
// WHY IT IS ITS OWN POINT. specs/stock.md makes the memory what decides which
// cards the waste shows — "The waste shows the cards it holds from the newest set
// that still holds any" — so a waste left holding cards with its memory intact
// shows cards that are gone. A build can get the column case right
// (`instrumentation/clear-pile`) and this one wrong, and it is graded here or
// nowhere: no other point calls `clearPile` on the waste, and
// `stock/recycle-clears-sets` decides the recycle, which is a different
// operation.
//
// SO THE BOARD IS FULL BEFORE THE CLEAR. All thirteen piles carry cards and the
// waste carries two sets, every card on the board is a different card, and each
// pile is printed — ids, suits, ranks and faces — before and after. The
// comparison is per pile, so a failure names the pile that emptied rather than
// reporting that "the board" changed.

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

it("empties the waste's set memory with the waste, and leaves the twelve", async () => {
  openTable(h);
  poseStock(h, STOCK_CARDS);
  poseWaste(h, WASTE_CARDS, WASTE_SETS);
  poseFoundation(h, 0, "spades", ACE);
  poseFoundation(h, 1, "hearts", ACE);
  poseFoundation(h, 2, "diamonds", ACE);
  poseFoundation(h, 3, "clubs", ACE);
  for (const column of COLUMNS) poseColumn(h, column, [COLUMN_CARDS[column]]);

  const before = h.snapshot();
  assertLength(
    before.wasteSets,
    WASTE_SETS.length,
    "the sets on the waste before the clear: an empty memory would say " +
      "nothing about emptying it",
  );

  h.debug.clearPile("waste", 0);
  const after = h.snapshot();

  await h.advance(1);
  captureStill(h, "board");

  assertLength(
    pileOf(after, "waste", 0),
    0,
    "cards left on the waste, the pile clearPile named: it removes every " +
      "card from it (specs/instrumentation.md)",
  );
  assertLength(
    after.wasteSets,
    0,
    "the sets left in the waste's memory: on the waste clearPile also " +
      "empties the set memory (specs/instrumentation.md)",
  );

  for (const { pile, index } of PILES) {
    if (pile === "waste") continue;
    assertDeepEqual(
      pileIdentity(after, pile, index),
      pileIdentity(before, pile, index),
      `the ${pile} pile ${index} after clearPile emptied the waste: ` +
        "clearPile leaves the other twelve piles standing " +
        "(specs/instrumentation.md)",
    );
  }
});
