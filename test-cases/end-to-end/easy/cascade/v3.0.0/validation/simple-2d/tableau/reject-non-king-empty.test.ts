// tableau/reject-non-king-empty — an empty column takes a King and nothing else.
//
// specs/tableau.md: an empty column accepts "a run led by a King", and "refuses
// every other run offered to it". The rank is the whole of the rule: no card below a
// King fills an empty column, whatever its suit or color.
// specs/instrumentation.md: a refused `move` returns `false` and leaves the board
// unchanged.
//
// THE TWO CARDS ARE THE TWO ENDS OF THE DECK BELOW A KING. The QUEEN is the card
// immediately under a King, so a build whose empty-column test is off by one rank —
// `rank >= 12`, or the "one lower than nothing" reading that lets the next card down
// stand in — accepts it. The ACE is the lowest card of all, so a build that treats
// an empty column as accepting anything at all, or that reads an empty column the
// way an empty FOUNDATION reads (specs/foundations.md: an empty foundation is the
// pile that takes an Ace), accepts that one. Neither is caught by the other, and the
// item's own description names both, so both are offered here and each is read in a
// failure of its own.
//
// The two cards wait in columns of their own and the target column is left empty
// throughout, so the second move is offered exactly the board the first one was.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  openTable,
  poseColumn,
  type Harness,
} from "../harness";
import { boardSpecs } from "./board";

/** The column left empty, which both cards are offered to. */
const TARGET = 4;
/** The column the Queen waits alone in, and the Queen. */
const QUEEN_COLUMN = 1;
const QUEEN = "QH";
/** The column the Ace waits alone in, and the Ace. */
const ACE_COLUMN = 6;
const ACE = "AS";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("refuses a Queen and an Ace offered to an empty column", async () => {
  openTable(h);
  poseColumn(h, QUEEN_COLUMN, [QUEEN]);
  poseColumn(h, ACE_COLUMN, [ACE]);
  const before = boardSpecs(h.snapshot());

  const queenAccepted = h.debug.move(
    "tableau",
    QUEEN_COLUMN,
    0,
    "tableau",
    TARGET,
  );
  const aceAccepted = h.debug.move("tableau", ACE_COLUMN, 0, "tableau", TARGET);
  const snapshot = h.snapshot();
  const after = boardSpecs(snapshot);
  await h.advance(1);
  captureStill(h, "refused");

  assertEqual(
    queenAccepted,
    false,
    `move of ${QUEEN} onto empty column ${TARGET}, which accepts a run led ` +
      "by a King alone (specs/tableau.md)",
  );
  assertEqual(
    aceAccepted,
    false,
    `move of ${ACE} onto empty column ${TARGET}, which accepts a run led ` +
      "by a King alone (specs/tableau.md)",
  );
  assertLength(
    snapshot.tableau[TARGET],
    0,
    `the cards in column ${TARGET} after both refusals: it is still empty ` +
      "(specs/tableau.md)",
  );
  assertDeepEqual(
    after,
    before,
    "the board after the two refused moves: each card is still alone in its " +
      "own column (specs/tableau.md)",
  );
});
