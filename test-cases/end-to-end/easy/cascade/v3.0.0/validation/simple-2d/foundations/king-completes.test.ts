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
  captureStill,
  createHarness,
  openTable,
  pileSpecs,
  poseColumn,
  poseFoundation,
  type Harness,
} from "../harness";

/** The foundation being completed, and the rank it is built to: its Queen. */
const FOUNDATION = 0;
const FOUNDATION_TOP_RANK = 12;
/** The column the King waits in. */
const COLUMN = 2;
/** The King of the foundation's own suit. */
const KING = "KS";
/** Cards on a complete foundation (specs/foundations.md). */
const COMPLETE = 13;
/** The completed foundation: its Ace through its King. */
const BUILT = [
  "AS",
  "2S",
  "3S",
  "4S",
  "5S",
  "6S",
  "7S",
  "8S",
  "9S",
  "10S",
  "JS",
  "QS",
  "KS",
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("accepts the King onto the Queen and completes the foundation", async () => {
  openTable(h);
  poseFoundation(h, FOUNDATION, "spades", FOUNDATION_TOP_RANK);
  poseColumn(h, COLUMN, [KING]);

  const accepted = h.debug.move("tableau", COLUMN, 0, "foundation", FOUNDATION);
  const after = h.snapshot();
  await h.advance(1);
  captureStill(h, "completed");

  assertEqual(
    accepted,
    true,
    `move of ${KING} onto the spade foundation built to its Queen, which a ` +
      "foundation building Ace to King accepts (specs/foundations.md)",
  );
  assertLength(
    after.foundations[FOUNDATION],
    COMPLETE,
    `the cards on foundation ${FOUNDATION}: a complete foundation holds ` +
      `${COMPLETE} (specs/foundations.md)`,
  );
  assertDeepEqual(
    pileSpecs(after.foundations[FOUNDATION]),
    BUILT,
    `foundation ${FOUNDATION} after the move: its Ace through its King, in ` +
      "order (specs/foundations.md)",
  );
});
