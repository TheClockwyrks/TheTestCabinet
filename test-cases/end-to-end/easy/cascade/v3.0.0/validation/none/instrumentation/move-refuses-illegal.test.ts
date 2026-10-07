// instrumentation/move-refuses-illegal — a move the rules refuse returns `false`
// and leaves the board exactly as it was.
//
// THE RULE. `specs/instrumentation.md`: `move` "returns ... `false` when they
// refused it", and "A refused move leaves the board unchanged."
//
// WHY IT IS A `broken` POINT, AND WHY THE TWO VERDICTS ARE TWO POINTS. A build
// whose `move` always answers `false` is a different defect from one that always
// answers `true`, and every suite that poses a board with `move` stands on one
// direction or the other. `instrumentation/move-accepts-legal` is the other half.
//
// THE MOVE IS ONE THE TABLE REFUSES OUTRIGHT: a King onto an EMPTY foundation,
// which `specs/foundations.md` refuses whatever else is on the board — an empty
// foundation takes an Ace and nothing else — so no ordering, colour or run rule
// is in play and the verdict is the whole of what is read.
//
// THE REFUSAL IS READ ON THE WHOLE BOARD. Every one of the thirteen piles is
// printed — ids, suits, ranks and faces — immediately before the refused move and
// compared afterwards, so a build that answers `false` and then quietly applies
// the move, or that half-applies it by lifting the King and dropping it back
// somewhere else, fails on the pile that changed.
//
// WHAT THIS DOES NOT DECIDE. The rules themselves, which are `foundations/*`'s,
// `tableau/*`'s and `runs/*`'s.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { SUITS, TABLEAU_COLUMNS } from "../constants";
import {
  captureStill,
  card,
  createHarness,
  openTable,
  pileOf,
  poseColumn,
  type CardView,
  type CascadeSnapshot,
  type Harness,
  type PileName,
} from "../harness";

/** The column and the foundation the refused move is attempted between. */
const ILLEGAL_COLUMN = 1;
const ILLEGAL_FOUNDATION = 1;
const ILLEGAL_CARD = "KH";

/** A second column, so the board the refusal must not touch holds more than one pile. */
const BYSTANDER_COLUMN = 3;
const BYSTANDER_CARDS = ["9D", "8S"] as const;

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

it("returns false for an illegal move and changes nothing", async () => {
  await openTable(h);
  await poseColumn(h, ILLEGAL_COLUMN, [card(ILLEGAL_CARD)]);
  await poseColumn(
    h,
    BYSTANDER_COLUMN,
    BYSTANDER_CARDS.map((t) => card(t)),
  );

  // The board as it stands with the refused move still to come.
  const standing = board(await h.snapshot());

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
  // board the refused move left.
  await captureStill(h, "board");

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
