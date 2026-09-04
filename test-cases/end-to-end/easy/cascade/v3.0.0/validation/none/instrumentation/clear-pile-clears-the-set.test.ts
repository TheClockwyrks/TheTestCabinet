// instrumentation/clear-pile-clears-the-set — `clearPile` on the waste empties
// its set memory as well as its cards, and leaves the other twelve piles
// standing.
//
// THE RULE. `specs/instrumentation.md`: "`clearPile` leaves the other twelve
// piles standing. On the waste it also empties the waste's set memory."
//
// WHY IT IS ITS OWN POINT. `specs/stock.md` makes the memory what decides which
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
import { assertEqual } from "../assert";
import { SUITS, TABLEAU_COLUMNS } from "../constants";
import {
  captureStill,
  card,
  cards,
  createHarness,
  faceDown,
  openTable,
  pileOf,
  poseColumn,
  poseFoundation,
  poseStock,
  poseWaste,
  type CardView,
  type CascadeSnapshot,
  type Harness,
  type PileName,
} from "../harness";

/** The stock and the waste this scenario lays, and the waste's two sets. */
const STOCK = ["5C", "6C", "7C"] as const;
const WASTE = ["5D", "6D", "7D"] as const;
const WASTE_SETS = [1, 2] as const;

/** The seven columns, each a face-down card under a face-up one. All different. */
const COLUMNS = [
  ["8S", "9S"],
  ["10S", "JS"],
  ["QS", "KS"],
  ["3H", "4H"],
  ["5H", "6H"],
  ["7H", "8H"],
  ["9H", "10H"],
] as const;

/** The thirteen piles, under the names `specs/instrumentation.md` addresses them by. */
const PILES: readonly { key: string; pile: PileName; index: number }[] = [
  { key: "the stock", pile: "stock", index: 0 },
  { key: "the waste", pile: "waste", index: 0 },
  ...SUITS.map((_, index) => ({
    key: `foundation ${index}`,
    pile: "foundation" as PileName,
    index,
  })),
  ...Array.from({ length: TABLEAU_COLUMNS }, (_, index) => ({
    key: `column ${index}`,
    pile: "tableau" as PileName,
    index,
  })),
];

/** One pile printed whole: id, suit, rank and face, bottom card first. */
function printPile(cards: readonly CardView[]): string {
  return cards.length === 0
    ? "(empty)"
    : cards
        .map((c) => `${c.id}:${c.suit}-${c.rank}${c.faceUp ? "u" : "d"}`)
        .join(" ");
}

/** Every pile of a board, keyed by the name a failure should name. */
function board(s: CascadeSnapshot): Record<string, string> {
  const printed: Record<string, string> = {};
  for (const place of PILES) {
    printed[place.key] = printPile(pileOf(s, place.pile, place.index));
  }
  return printed;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("empties the waste's set memory with the waste, and nothing else", async () => {
  await openTable(h);
  await poseStock(h, faceDown(...STOCK));
  await poseWaste(h, cards(...WASTE), [...WASTE_SETS]);
  for (const [index, suit] of SUITS.entries()) {
    await poseFoundation(h, index, suit, index + 1);
  }
  for (const [index, column] of COLUMNS.entries()) {
    await poseColumn(h, index, [card(column[0], false), card(column[1])]);
  }

  const before = await h.snapshot();
  const standing = board(before);
  assertEqual(
    before.wasteSets.length,
    WASTE_SETS.length,
    `the sets on the waste before the clear — an empty memory would say ` +
      `nothing about emptying it`,
  );

  await h.debug.clearPile("waste", 0);

  const after = await h.snapshot();
  const left = board(after);

  await h.advance(1);
  // Before the assertions, so a clear that reached too far still leaves the
  // picture of the board it left.
  await captureStill(h, "board");

  assertEqual(
    left["the waste"],
    "(empty)",
    `the waste after clearPile("waste", 0)`,
  );
  assertEqual(
    after.wasteSets.length,
    0,
    `the sets left in the waste's memory after clearPile("waste", 0) — on the ` +
      `waste the clear also empties the set memory (specs/instrumentation.md)`,
  );

  for (const place of PILES) {
    if (place.pile === "waste") continue;
    assertEqual(
      left[place.key],
      standing[place.key],
      `${place.key} after clearPile("waste", 0), against what it held before ` +
        `it — the clear leaves the other twelve piles standing ` +
        `(specs/instrumentation.md)`,
    );
  }
});
