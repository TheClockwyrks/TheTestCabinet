// foundations/king-completes — a King lands on the Queen and completes a
// foundation.
//
// specs/foundations.md: a foundation builds one suit upward from Ace to King, so a
// foundation whose top card is the Queen of its suit accepts that suit's King. "A
// foundation is complete when it holds thirteen cards, its Ace through its King."
// specs/instrumentation.md: `move` returns `true` when the game's own rules accepted
// it.
//
// THE POSE. One foundation built to its Queen and the King of the same suit alone in
// a column. This is the last acceptance a foundation makes, and a build that stops
// short of the King — an off-by-one on the rank ceiling, or a completion test that
// closes the foundation at twelve — refuses it and fails here, where
// `build-up-same-suit` in the middle of the run passes.
//
// The other three foundations are left empty, so the board is thirteen cards short
// of the fifty-two `specs/victory.md` wins on: this move completes a foundation and
// nothing else, and no win intrudes on the reading.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import {
  ALL_RANKS,
  captureStill,
  card,
  createHarness,
  KING,
  openTable,
  poseColumn,
  poseFoundation,
  QUEEN,
  type Harness,
} from "../harness";
import { builtText, pileText } from "./board";

/** The foundation being completed, its suit, and the rank it is built to. */
const FOUNDATION = 0;
const FOUNDATION_SUIT = "spades";
const FOUNDATION_TOP_RANK = QUEEN;
/** The column the King waits in. */
const COLUMN = 2;
/** The King of the foundation's own suit. */
const OFFERED = card(FOUNDATION_SUIT, KING);
const OFFERED_TEXT = "KS";
/**
 * Cards on a complete foundation: one of each rank, Ace through King
 * (specs/foundations.md, specs/deal.md).
 */
const COMPLETE = ALL_RANKS.length;
/** The completed foundation: its Ace through its King. */
const BUILT = builtText(FOUNDATION_SUIT, KING);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("accepts the King onto the Queen and completes the foundation", async () => {
  openTable(h);
  poseFoundation(h, FOUNDATION, FOUNDATION_SUIT, FOUNDATION_TOP_RANK);
  poseColumn(h, COLUMN, [OFFERED]);

  const accepted = h.debug.move("tableau", COLUMN, 0, "foundation", FOUNDATION);
  const after = h.snapshot();
  await h.advance(1);
  captureStill(h, "completed");

  assertEqual(
    accepted,
    true,
    `move of ${OFFERED_TEXT} onto the ${FOUNDATION_SUIT} foundation built to ` +
      "its Queen, which a foundation building Ace to King accepts " +
      "(specs/foundations.md)",
  );
  assertLength(
    after.foundations[FOUNDATION],
    COMPLETE,
    `the cards on foundation ${FOUNDATION}: a complete foundation holds ` +
      `${COMPLETE} (specs/foundations.md)`,
  );
  assertDeepEqual(
    pileText(after.foundations[FOUNDATION]),
    BUILT,
    `foundation ${FOUNDATION} after the move: its Ace through its King, in ` +
      "order (specs/foundations.md)",
  );
});
