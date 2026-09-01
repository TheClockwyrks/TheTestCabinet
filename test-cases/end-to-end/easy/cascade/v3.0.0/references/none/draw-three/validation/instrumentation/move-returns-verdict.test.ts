// instrumentation/move-returns-verdict — `move` reports what the game's own rules
// decided, and a refused move leaves the board untouched.
//
// THE RULE. `specs/instrumentation.md`: `move(fromPile, fromIndex, fromRow,
// toPile, toIndex)` "Attempts a move and returns whether the rules accepted it",
// and "It returns `true` when the game's own rules accepted the move and `false`
// when they refused it. An accepted move applies through the same path a released
// drop uses ... A refused move leaves the board unchanged."
//
// WHY IT IS A `broken` POINT. `move` is the operation this suite drives the rules
// through — the `tableau`, `foundations`, `runs` and `winning` groups all read
// their verdicts out of it — and a build whose `move` reports `true` for
// everything, or that applies a move it says it refused, turns every one of those
// grades into a reading of something else.
//
// BOTH DIRECTIONS ARE DRIVEN ON ONE BOARD, and they are chosen so the two
// verdicts cannot be confused with the rules they rest on:
//
//   - the accepted one is an Ace onto an EMPTY foundation, which
//     `specs/foundations.md` accepts whatever the suit, so no ordering, colour or
//     run rule is in play;
//   - the refused one is a King onto another empty foundation, which the same
//     table refuses outright — an empty foundation takes an Ace and nothing else.
//
// THE REFUSAL IS READ ON THE WHOLE BOARD. Every pile is printed — ids, suits,
// ranks and faces — immediately before the refused move and compared afterwards,
// so a build that answers `false` and then quietly applies the move, or that
// half-applies it by lifting the King and dropping it back somewhere else, fails
// on the pile that changed.
//
// WHAT THIS DOES NOT DECIDE. The rules themselves. Which cards a foundation
// accepts is `foundations/*`'s, which runs a column accepts is `tableau/*`'s, and
// what a whole run does when it moves is `runs/*`'s. This point decides only that
// the verdict is reported and that a refusal costs nothing.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { SUITS, TABLEAU_COLUMNS } from "../constants";
import {
  captureStill,
  card,
  cardKey,
  createHarness,
  openTable,
  pileOf,
  poseColumn,
  topOf,
  type CardView,
  type CascadeSnapshot,
  type Harness,
  type PileName,
} from "../harness";

/** The column and the foundation the accepted move runs between. */
const LEGAL_COLUMN = 0;
const LEGAL_FOUNDATION = 0;
const LEGAL_CARD = "AS";

/** The column and the foundation the refused move is attempted between. */
const ILLEGAL_COLUMN = 1;
const ILLEGAL_FOUNDATION = 1;
const ILLEGAL_CARD = "KH";

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

it("accepts and applies a legal move, and refuses an illegal one for nothing", async () => {
  await openTable(h);
  await poseColumn(h, LEGAL_COLUMN, [card(LEGAL_CARD)]);
  await poseColumn(h, ILLEGAL_COLUMN, [card(ILLEGAL_CARD)]);

  const accepted = await h.debug.move(
    "tableau",
    LEGAL_COLUMN,
    0,
    "foundation",
    LEGAL_FOUNDATION,
  );
  const applied = await h.snapshot();

  // The board as it stands with the refused move still to come.
  const standing = board(applied);

  const refused = await h.debug.move(
    "tableau",
    ILLEGAL_COLUMN,
    0,
    "foundation",
    ILLEGAL_FOUNDATION,
  );
  const after = await h.snapshot();

  await h.advance(1);
  // Before the assertions, so a wrong verdict still leaves the picture of the
  // board the two moves left.
  await captureStill(h, "board");

  assertEqual(
    accepted,
    true,
    `the verdict move() returned on sending the ${LEGAL_CARD} from column ` +
      `${LEGAL_COLUMN} to the empty foundation ${LEGAL_FOUNDATION}, which ` +
      `accepts an Ace of any suit (specs/foundations.md)`,
  );
  const home = topOf(pileOf(applied, "foundation", LEGAL_FOUNDATION));
  assertEqual(
    home === undefined ? "no card" : cardKey(home),
    cardKey(card(LEGAL_CARD)),
    `the card on foundation ${LEGAL_FOUNDATION} once the move was accepted — ` +
      `an accepted move APPLIES (specs/instrumentation.md)`,
  );
  assertLength(
    pileOf(applied, "tableau", LEGAL_COLUMN),
    0,
    `the cards left in column ${LEGAL_COLUMN} once its only card went home`,
  );

  assertEqual(
    refused,
    false,
    `the verdict move() returned on offering the ${ILLEGAL_CARD} to the empty ` +
      `foundation ${ILLEGAL_FOUNDATION}, which accepts an Ace and nothing ` +
      `else (specs/foundations.md)`,
  );
  const left = board(after);
  for (const place of PILES) {
    assertEqual(
      left[place.key],
      standing[place.key],
      `${place.key} after the refused move, against what it held immediately ` +
        `before it — a refused move leaves the board unchanged ` +
        `(specs/instrumentation.md)`,
    );
  }
});
