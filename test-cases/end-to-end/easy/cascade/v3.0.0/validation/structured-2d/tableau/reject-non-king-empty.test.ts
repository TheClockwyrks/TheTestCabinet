// tableau/reject-non-king-empty — an empty column takes a King and nothing else.
//
// specs/tableau.md: an empty column accepts a run led by A KING, and refuses every
// other run offered to it.
// specs/instrumentation.md: a refused `move` returns `false` and leaves the board
// unchanged.
//
// THE TWO DISTINGUISHING RANKS, which is why the manifest makes this one item. The
// Queen is the rank immediately below the King, so a build that admits anything from
// the Queen up, or that is off by one about which rank the King is, accepts her and
// fails here. The Ace is the deck's other end, so a build that lets an empty column
// take anything at all — the shape a build writes when an empty column has no lowest
// card to compare against and the comparison is skipped rather than replaced —
// accepts it and fails here too. A build that refuses the Queen and takes the Ace,
// or the other way about, fails on the one it took, and the failure names it.
//
// The two cards wait in columns of their own and no King is anywhere on the table,
// so nothing else could have moved and nothing else could have been accepted.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  ACE,
  card,
  captureStill,
  createHarness,
  openTable,
  poseColumn,
  QUEEN,
  type Harness,
} from "../harness";
import { boardText } from "./board";

/** The column that holds nothing, which is the state the rule names. */
const EMPTY_COLUMN = 0;

/** The rank immediately below the King, waiting alone in a column of its own. */
const QUEEN_COLUMN = 3;
const QUEEN_CARD = card("spades", QUEEN);
const QUEEN_TEXT = "QS";

/** The deck's lowest rank, waiting alone in a column of its own. */
const ACE_COLUMN = 5;
const ACE_CARD = card("hearts", ACE);
const ACE_TEXT = "AH";

/** Each card is the only card in its column, so each is at its column's row zero. */
const ROW = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("refuses a Queen and an Ace offered to a column holding nothing", async () => {
  openTable(h);
  poseColumn(h, QUEEN_COLUMN, [QUEEN_CARD]);
  poseColumn(h, ACE_COLUMN, [ACE_CARD]);
  const before = boardText(h.snapshot());

  const queenAccepted = h.debug.move(
    "tableau",
    QUEEN_COLUMN,
    ROW,
    "tableau",
    EMPTY_COLUMN,
  );
  const aceAccepted = h.debug.move(
    "tableau",
    ACE_COLUMN,
    ROW,
    "tableau",
    EMPTY_COLUMN,
  );
  const after = boardText(h.snapshot());
  await h.advance(1);
  captureStill(h, "refused");

  assertEqual(
    queenAccepted,
    false,
    `move of ${QUEEN_TEXT} onto column ${EMPTY_COLUMN}, which holds nothing ` +
      "and accepts a run led by a King alone (specs/tableau.md)",
  );
  assertEqual(
    aceAccepted,
    false,
    `move of ${ACE_TEXT} onto column ${EMPTY_COLUMN}, which holds nothing ` +
      "and accepts a run led by a King alone (specs/tableau.md)",
  );
  assertDeepEqual(
    after,
    before,
    `the board after the two refused moves: column ${EMPTY_COLUMN} still ` +
      "holds nothing and both cards are still in their columns " +
      "(specs/tableau.md)",
  );
});
