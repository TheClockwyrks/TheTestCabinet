// instrumentation/move-returns-verdict — `move` reports what the game's own
// rules decided, and a refusal changes nothing.
//
// THE RULE. specs/instrumentation.md, under The game's own events: `move`
// "returns `true` when the game's own rules accepted the move and `false` when
// they refused it. An accepted move applies through the same path a released
// drop uses ... A refused move leaves the board unchanged." Every scenario in
// this suite that reaches a position through moves reads that verdict, so a
// build that always answers `true`, or that answers correctly and applies
// nothing, makes every one of them silently wrong.
//
// BOTH DIRECTIONS, EACH IN ITS OWN READING, so a build that accepts everything
// grades differently from one that refuses everything. The two scenarios differ
// in ONE card: the run offered to a red seven is a black six in the first and a
// RED six in the second, so the only thing separating the accepted move from the
// refused one is the colour rule specs/tableau.md states — nothing about the
// call, the piles, or the board.
//
// THE REFUSAL IS READ AS THE WHOLE BOARD, by identity: every card of both
// columns is held to the id, suit, rank and face it carried before the call, so
// a build that "refuses" by moving the card and moving it back, or by turning
// something over on the way, fails as well.
//
// WHAT IT DOES NOT DECIDE. Which runs a column accepts is the `tableau` group's,
// and this point deliberately uses the plainest of its rules so a failure here
// reads as a fault in the verdict rather than in the rule.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import {
  SEVEN,
  SIX,
  captureStill,
  card,
  createHarness,
  openTable,
  pileOf,
  poseColumn,
  topOf,
  type CascadeSnapshot,
  type Harness,
} from "../harness";

/** The column offered to, and the column the single card is lifted from. */
const TARGET_COLUMN = 0;
const SOURCE_COLUMN = 1;

/** The card standing on the target: a red seven, which takes a black six. */
const TARGET_CARD = card("hearts", SEVEN);

/** The card the rules accept, and the card they refuse: one rank, two colours. */
const LEGAL_CARD = card("spades", SIX);
const ILLEGAL_CARD = card("diamonds", SIX);

/** Both columns as identity, face and order — the whole of what a refusal keeps. */
function board(snapshot: CascadeSnapshot): unknown {
  return [TARGET_COLUMN, SOURCE_COLUMN].map((column) =>
    pileOf(snapshot, "tableau", column).map((entry) => ({
      id: entry.id,
      suit: entry.suit,
      rank: entry.rank,
      faceUp: entry.faceUp,
    })),
  );
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("returns true for a legal move and applies it", async () => {
  openTable(h);
  poseColumn(h, TARGET_COLUMN, [TARGET_CARD]);
  const [movedId] = poseColumn(h, SOURCE_COLUMN, [LEGAL_CARD]);

  const verdict = h.debug.move(
    "tableau",
    SOURCE_COLUMN,
    0,
    "tableau",
    TARGET_COLUMN,
  );
  const after = h.snapshot();

  assertEqual(
    verdict,
    true,
    `the verdict move() returned for the ${LEGAL_CARD.suit} six offered to ` +
      `the ${TARGET_CARD.suit} seven, one rank lower and the other colour, ` +
      "which a column accepts (specs/tableau.md)",
  );
  assertEqual(
    topOf(pileOf(after, "tableau", TARGET_COLUMN))?.id,
    movedId,
    `the card lowest on column ${TARGET_COLUMN} after the accepted move: an ` +
      "accepted move applies (specs/instrumentation.md)",
  );
  assertLength(
    pileOf(after, "tableau", SOURCE_COLUMN),
    0,
    `cards left on column ${SOURCE_COLUMN} after the accepted move`,
  );
});

it("returns false for an illegal move and leaves the board exactly as it was", async () => {
  openTable(h);
  poseColumn(h, TARGET_COLUMN, [TARGET_CARD]);
  poseColumn(h, SOURCE_COLUMN, [ILLEGAL_CARD]);

  const before = board(h.snapshot());

  const verdict = h.debug.move(
    "tableau",
    SOURCE_COLUMN,
    0,
    "tableau",
    TARGET_COLUMN,
  );
  const after = h.snapshot();

  // The declared output is the board a verdict left behind, and the refused
  // one is the board that has to look untouched: the accepted move is read by
  // the assertions above rather than by a second picture.
  await h.advance(1);
  captureStill(h, "board");

  assertEqual(
    verdict,
    false,
    `the verdict move() returned for the ${ILLEGAL_CARD.suit} six offered to ` +
      `the ${TARGET_CARD.suit} seven, one rank lower and the SAME colour, ` +
      "which a column refuses (specs/tableau.md)",
  );
  assertDeepEqual(
    board(after),
    before,
    `columns ${TARGET_COLUMN} and ${SOURCE_COLUMN} after the refused move, ` +
      "read bottom card first: a refused move leaves the board unchanged " +
      "(specs/instrumentation.md)",
  );
});
