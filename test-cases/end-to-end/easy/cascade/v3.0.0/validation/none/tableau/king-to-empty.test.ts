// tableau/king-to-empty — an empty column takes a King.
//
// THE RULE. `specs/tableau.md`, the acceptance table: a column that is "Empty"
// accepts "A run led by a King". This check decides that row in the ACCEPTING
// direction: the King is taken, and it is the column's only card afterwards.
//
// THE POSE. One King, alone in a column of its own, and an empty column beside
// it on an otherwise empty table. `openTable` clears all thirteen piles, so the
// target column is empty because nothing was put in it rather than because
// something was taken out of it, and the King is the only card that can move.
//
// THE KING MOVES ALONE, so the run offered is a run of one and the King-headed
// RUN is somebody else's point: `runs/king-run-to-empty` is where a longer run
// led by a King is decided.
//
// The four faculty gates are left at their reset defaults, which are all on.
// None can fire: the source column is emptied rather than left with a face-down
// card lowest, so `autoFlip` has nothing to turn, and no card goes home, so
// `winDetect` has nothing to declare.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import { RANK_MAX } from "../constants";
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

/** The empty column the King is offered to. */
const TARGET = 1;

/** The column the King is offered from, and where it sits in that column. */
const SOURCE = 0;
const SOURCE_ROW = 0;

/** The King. `specs/tableau.md` names the rank, not the suit. */
const KING = card("KS");

/** One frame, so the still shows the board the move left. */
const DRAW_FRAMES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("takes a King onto an empty column and leaves it standing there", async () => {
  await openTable(h);
  const [kingId] = await poseColumn(h, SOURCE, [KING]);

  const accepted = await h.debug.move(
    "tableau",
    SOURCE,
    SOURCE_ROW,
    "tableau",
    TARGET,
  );

  await h.advance(DRAW_FRAMES);
  await captureStill(h, "accepted");
  const after = await h.snapshot();

  assertEqual(
    accepted,
    true,
    `move's verdict on the ${KING.suit} King (rank ${RANK_MAX}) offered to ` +
      `empty column ${TARGET} — specs/tableau.md: an empty column accepts a ` +
      "run led by a King",
  );
  assertDeepEqual(
    whereIs(after, kingId),
    { pile: "tableau", index: TARGET, row: 0 },
    `where the King (id ${kingId}) sits after the move — it is the empty ` +
      `column's first and only card. A reading naming column ${SOURCE} is a ` +
      "build that refused it",
  );
  assertLength(
    pileOf(after, "tableau", TARGET),
    1,
    `the cards in column ${TARGET} after the King was accepted`,
  );
  assertLength(
    pileOf(after, "tableau", SOURCE),
    0,
    `the cards left in column ${SOURCE}, which held nothing but the King`,
  );
});
