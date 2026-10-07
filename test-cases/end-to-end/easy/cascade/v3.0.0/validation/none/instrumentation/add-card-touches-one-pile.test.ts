// instrumentation/add-card-touches-one-pile — `addCard` changes the pile it
// names and nothing else on the board.
//
// THE RULE. `specs/instrumentation.md`: "It touches no other pile and no other
// field, the waste's set memory included."
//
// WHY THE SET MEMORY IS NAMED. The waste's sets are the one field on the board
// that is not a pile of cards, and they are the one a plausible implementation
// would recompute rather than leave alone — an `addCard` that rebuilt the memory
// from the waste's length, or that appended a set of one for every card added,
// would leave every scenario in the `stock` and `draw-three` groups posing a
// waste it never asked for. `specs/stock.md` makes the memory what decides which
// cards the waste shows, so a build that disturbs it here shows the wrong cards
// everywhere.
//
// SO THE BOARD IS FULL BEFORE THE ADD. All thirteen piles carry cards and the
// waste carries two sets, and every one of them is printed — ids, suits, ranks
// and faces — before and after the single addition. The comparison is per pile,
// so a failure names the pile that moved rather than reporting that "the board"
// changed.
//
// THE ADDITION IS MADE TO A COLUMN THAT ALREADY HOLDS CARDS, so a build that
// clears a pile before adding to it fails on its own column as well.
//
// WHAT THIS DOES NOT DECIDE. That the card landed on the TOP of its own pile,
// which is `instrumentation/add-card-appends`'s point: the target column is
// deliberately excluded from the comparison here.

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

/** The column the card is added to, and the card added. */
const TARGET_COLUMN = 6;
const ADDED = "JD";

/** The stock and the waste this scenario lays, and the waste's two sets. */
const STOCK = ["5C", "6C", "7C"] as const;
const WASTE = ["5D", "6D", "7D"] as const;
const WASTE_SETS = [1, 2] as const;

/**
 * The seven columns, each a face-down card under a face-up one.
 *
 * Every card on the board is a different card, so a pile that changed is named
 * by what it now holds rather than by an index into identical entries.
 */
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

it("leaves the other twelve piles and the waste's sets exactly as they were", async () => {
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

  const added = card(ADDED);
  await h.debug.addCard(
    "tableau",
    TARGET_COLUMN,
    added.suit,
    added.rank,
    added.faceUp ?? true,
  );

  const after = await h.snapshot();
  const left = board(after);

  await h.advance(1);
  // Before the assertions, so a stray change still leaves the picture of the
  // board the single addition was made to.
  await captureStill(h, "board");

  for (const place of PILES) {
    if (place.pile === "tableau" && place.index === TARGET_COLUMN) continue;
    assertEqual(
      left[place.key],
      standing[place.key],
      `${place.key} after one addCard onto column ${TARGET_COLUMN}, against ` +
        `what it held before it — an add touches no other pile ` +
        `(specs/instrumentation.md)`,
    );
  }

  assertEqual(
    after.wasteSets.join(","),
    before.wasteSets.join(","),
    `the waste's set memory after that add, against the ` +
      `[${WASTE_SETS.join(", ")}] it held before it — an add touches no other ` +
      `field, the waste's set memory included (specs/instrumentation.md)`,
  );
});
