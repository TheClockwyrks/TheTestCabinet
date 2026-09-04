// tableau/reject-non-king-empty — an empty column takes a King and nothing else.
//
// THE RULE. `specs/tableau.md`, the acceptance table: a column that is "Empty"
// accepts "A run led by a King", and the file says a column "refuses every other
// run offered to it". This check decides that row in the REFUSING direction,
// which `tableau/king-to-empty` cannot reach.
//
// TWO CARDS, AT THE TWO ENDS OF THE RANK ORDER, SO EVERY WRONG MODEL READS AS A
// DIFFERENT NUMBER. A build that lets an empty column take anything takes both,
// and the column reads two cards. A build that has the rule but reads the wrong
// end of the rank order — an Ace where the King belongs, the way a foundation
// starts — takes the Ace alone, and the column reads one card holding an Ace. A
// build that takes the highest card offered and calls that the rule takes the
// Queen alone, and the column reads one card holding a Queen. Only the stated
// rule leaves the column empty, and the reading names which of the three a
// failing build implemented.
//
// The Queen is offered first, so a build that took it would then be offered the
// Ace by a column that is no longer empty, and both readings would still name
// what happened. Each card sits in a column of its own, so a refusal that
// quietly moved one somewhere else is named by `whereIs` rather than hidden by
// the other card standing in the same pile.
//
// The four faculty gates are left at their reset defaults, which are all on.
// Refused moves apply nothing, so none of them has anything to do.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import {
  captureStill,
  card,
  createHarness,
  openTable,
  pileOf,
  poseColumn,
  whereIs,
  type Harness,
} from "../harness";

/** The empty column both cards are offered to. */
const TARGET = 0;

/** The column holding the Queen, one rank below the King the rule admits. */
const QUEEN_COLUMN = 1;
const QUEEN = card("QS");

/** The column holding the Ace, the far end of the rank order. */
const ACE_COLUMN = 2;
const ACE = card("AS");

/** Where each card sits in its own column, counted from the bottom. */
const SOURCE_ROW = 0;

/** One frame, so the still shows the board the two refusals left. */
const DRAW_FRAMES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("refuses a Queen and an Ace on an empty column, and leaves both where they were", async () => {
  await openTable(h);
  const [queenId] = await poseColumn(h, QUEEN_COLUMN, [QUEEN]);
  const [aceId] = await poseColumn(h, ACE_COLUMN, [ACE]);

  const queenAccepted = await h.debug.move(
    "tableau",
    QUEEN_COLUMN,
    SOURCE_ROW,
    "tableau",
    TARGET,
  );
  const aceAccepted = await h.debug.move(
    "tableau",
    ACE_COLUMN,
    SOURCE_ROW,
    "tableau",
    TARGET,
  );

  await h.advance(DRAW_FRAMES);
  await captureStill(h, "refused");
  const after = await h.snapshot();

  assertEqual(
    queenAccepted,
    false,
    `move's verdict on the ${QUEEN.suit} Queen offered to empty column ` +
      `${TARGET} — specs/tableau.md: an empty column accepts a run led by a ` +
      "King and refuses every other run offered to it",
  );
  assertEqual(
    aceAccepted,
    false,
    `move's verdict on the ${ACE.suit} Ace offered to empty column ${TARGET} ` +
      "— an Ace starts a foundation, not a column",
  );
  assertLength(
    pileOf(after, "tableau", TARGET),
    0,
    `the cards in column ${TARGET} after both were offered to it — two is a ` +
      "build that lets an empty column take anything, one is a build that " +
      "took the wrong one of them",
  );
  assertDeepEqual(
    whereIs(after, queenId),
    { pile: "tableau", index: QUEEN_COLUMN, row: 0 },
    `where the Queen (id ${queenId}) sits after its refusal — ` +
      "specs/tableau.md: a refused move changes nothing",
  );
  assertDeepEqual(
    whereIs(after, aceId),
    { pile: "tableau", index: ACE_COLUMN, row: 0 },
    `where the Ace (id ${aceId}) sits after its refusal`,
  );
});
