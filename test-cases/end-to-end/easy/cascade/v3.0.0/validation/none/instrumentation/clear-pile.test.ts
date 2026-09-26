// instrumentation/clear-pile — `clearPile` empties the one pile it names and
// leaves the other twelve standing.
//
// THE RULE. `specs/instrumentation.md`: `clearPile(pile, index)` "Removes every
// card from the named pile", and "`clearPile` leaves the other twelve piles
// standing."
//
// WHY IT IS A `broken` POINT. It is how a scenario says what a pile holds when it
// wants a pile to hold nothing, and a build that clears the whole table instead
// would silently empty the rest of every board this suite poses — every check
// downstream would then be grading a table it never asked for.
//
// SO THE BOARD IS FULL BEFORE THE CLEAR. All thirteen piles carry cards and the
// waste carries two sets, every card on the board is a different card, and each
// pile is printed — ids, suits, ranks and faces — before and after. The
// comparison is per pile, so a failure names the pile that emptied rather than
// reporting that "the board" changed: a build that cleared the whole tableau
// fails on six columns, one that cleared the whole table fails on twelve piles,
// and one that cleared the wrong column fails on two.
//
// THE PILE CLEARED IS A COLUMN IN THE MIDDLE OF THE SEVEN, so a build indexing
// its columns from the wrong end empties column 3's mirror rather than column 3.
//
// THE WASTE'S SETS ARE READ HERE TOO, from this side of the rule. `specs/stock.md`
// makes the memory what decides which cards the waste shows, so a waste left
// holding its cards with its memory emptied is a waste that shows nothing:
// clearing a COLUMN must leave the memory exactly as it was, which the reading
// below takes. The other side — that clearing the WASTE empties both — is
// `instrumentation/clear-pile-clears-the-set`'s.

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

/** The pile cleared: a column from the middle of the seven. */
const CLEARED_COLUMN = 3;

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

it("empties the named pile and leaves the other twelve standing", async () => {
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

  await h.debug.clearPile("tableau", CLEARED_COLUMN);

  const after = await h.snapshot();
  const left = board(after);

  await h.advance(1);
  // Before the assertions, so a clear that reached too far still leaves the
  // picture of the board it left.
  await captureStill(h, "board");

  assertEqual(
    left[`column ${CLEARED_COLUMN}`],
    "(empty)",
    `column ${CLEARED_COLUMN} after clearPile("tableau", ${CLEARED_COLUMN})`,
  );

  for (const place of PILES) {
    if (place.pile === "tableau" && place.index === CLEARED_COLUMN) continue;
    assertEqual(
      left[place.key],
      standing[place.key],
      `${place.key} after clearPile("tableau", ${CLEARED_COLUMN}), against ` +
        `what it held before it — the clear leaves the other twelve piles ` +
        `standing (specs/instrumentation.md)`,
    );
  }

  assertEqual(
    after.wasteSets.join(","),
    before.wasteSets.join(","),
    `the waste's set memory after clearing a column, against the ` +
      `[${WASTE_SETS.join(", ")}] it held before it — the waste was not the ` +
      `pile named, and a waste left holding cards with an emptied memory ` +
      `shows nothing (specs/stock.md)`,
  );
});
