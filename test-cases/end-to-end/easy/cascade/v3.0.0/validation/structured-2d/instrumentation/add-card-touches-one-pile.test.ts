// instrumentation/add-card-touches-one-pile — an addition reaches its own pile
// and nothing else.
//
// THE RULE. specs/instrumentation.md, under The cards: `addCard` "touches no
// other pile and no other field, the waste's set memory included." That last
// clause is the sharp one. The waste's memory and the cards on the waste are two
// different things (specs/stock.md): a build that treats the memory as a
// derived count of the cards it holds, or that appends a set whenever a card
// arrives anywhere, silently rewrites the memory every time a scenario poses a
// board — and every waste scenario in the suite is then posed on a table that
// does not say what the scenario asked for.
//
// THE BOARD CARRIES SOMETHING IN ALL THIRTEEN PILES, so there is a reading to
// spoil everywhere: a build that clears a pile it did not mean to touch, or
// re-sorts one, reads differently in that pile alone and the failure names it.
//
// THE COMPARISON IS BY IDENTITY, not by count. Every card is compared with its
// id, its suit, its rank and its face, so a build that rebuilt an untouched pile
// out of fresh cards fails here even though the pile still "holds what it held".
// That is the reading the Identity rule asks for: a card keeps its id for as
// long as it is on the table (specs/instrumentation.md).
//
// WHAT IT DOES NOT DECIDE. Where in its OWN pile the card lands is
// `instrumentation/add-card-appends`.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertLength } from "../assert";
import {
  ACE,
  COLUMNS,
  EIGHT,
  FIVE,
  FOUNDATIONS,
  FOUR,
  JACK,
  KING,
  NINE,
  QUEEN,
  SEVEN,
  SIX,
  TEN,
  THREE,
  TWO,
  captureStill,
  card,
  createHarness,
  openTable,
  pileOf,
  poseCard,
  poseColumn,
  poseFoundation,
  poseStock,
  poseWaste,
  type CascadeSnapshot,
  type Harness,
  type PileKind,
} from "../harness";

/** The column the card is added to. */
const TOUCHED_COLUMN = 3;

/** The card added, of a suit and rank no posed card carries. */
const ADDED = card("hearts", KING);

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

it("leaves the other twelve piles and the waste's sets exactly as they were", async () => {
  openTable(h);
  poseStock(h, STOCK_CARDS);
  poseWaste(h, WASTE_CARDS, WASTE_SETS);
  // One foundation per suit, each holding its Ace: any suit may start any slot
  // (specs/foundations.md).
  poseFoundation(h, 0, "spades", ACE);
  poseFoundation(h, 1, "hearts", ACE);
  poseFoundation(h, 2, "diamonds", ACE);
  poseFoundation(h, 3, "clubs", ACE);
  for (const column of COLUMNS) poseColumn(h, column, [COLUMN_CARDS[column]]);

  const before = h.snapshot();

  poseCard(h, "tableau", TOUCHED_COLUMN, ADDED);
  const after = h.snapshot();

  await h.advance(1);
  captureStill(h, "board");

  for (const { pile, index } of PILES) {
    if (pile === "tableau" && index === TOUCHED_COLUMN) continue;
    assertDeepEqual(
      pileIdentity(after, pile, index),
      pileIdentity(before, pile, index),
      `the ${pile} pile ${index} after one addCard onto column ` +
        `${TOUCHED_COLUMN}: addCard touches no other pile ` +
        "(specs/instrumentation.md)",
    );
  }

  assertDeepEqual(
    after.wasteSets,
    before.wasteSets,
    "the waste's set memory after one addCard onto a column: addCard touches " +
      "no other field, the waste's set memory included " +
      "(specs/instrumentation.md)",
  );

  // The card really did arrive, so none of the readings above passed because
  // nothing happened.
  assertLength(
    pileOf(after, "tableau", TOUCHED_COLUMN),
    pileOf(before, "tableau", TOUCHED_COLUMN).length + 1,
    `cards on column ${TOUCHED_COLUMN} after the addition`,
  );
});
