// instrumentation/move-refuses-illegal — a move the rules refuse returns `false`
// and leaves the board exactly as it was.
//
// THE RULE. specs/instrumentation.md: `move` "returns ... `false` when they
// refused it", and "A refused move leaves the board unchanged."
//
// WHY IT IS A `broken` POINT, AND WHY THE TWO VERDICTS ARE TWO POINTS. A build
// whose `move` always answers `false` is a different defect from one that always
// answers `true`, and every suite that poses a board with `move` stands on one
// direction or the other. `instrumentation/move-accepts-legal` is the other half.
//
// THE MOVE IS ONE THE TABLE REFUSES OUTRIGHT: a King onto an EMPTY foundation,
// which specs/foundations.md refuses whatever else is on the board — an empty
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
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  card,
  createHarness,
  openTable,
  pileOf,
  poseColumn,
  SEVEN,
  SIX,
  type CascadeSnapshot,
  type Harness,
} from "../harness";

/** The column offered to, and the column the single card is lifted from. */
const TARGET_COLUMN = 0;
const SOURCE_COLUMN = 1;

/** The card standing on the target: a red seven, which takes a black six. */
const TARGET_CARD = card("hearts", SEVEN);

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
