// foundations/reject-off-suit — a started foundation refuses another suit.
//
// specs/foundations.md: a foundation whose top card is rank `r` of suit `s` accepts
// the card of rank `r + 1` AND suit `s`, and refuses every other card. Once a
// foundation holds a card it is locked to that card's suit.
// specs/instrumentation.md: a refused `move` returns `false` and leaves the board
// unchanged.
//
// THE DISTINGUISHING SUIT. The spade foundation is built to its five and the six of
// CLUBS is offered: the right rank, the wrong suit, and the SAME COLOR. So a build
// that borrowed the tableau's alternating-color test, or that checks the color
// where it should check the suit, accepts it and fails here, while the rank test
// alone cannot tell this card from the one `build-up-same-suit` offers. The six of
// spades is nowhere on the table, so the refusal cannot come out right by some other
// card going instead.
//
// The clubs foundation is not started, so no foundation on the table would accept
// the six of clubs by any rule; the move names foundation 0 in any case.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  openTable,
  poseColumn,
  poseFoundation,
  type Harness,
} from "../harness";
import { boardSpecs } from "./board";

/** The started foundation, and the rank it is built to. */
const FOUNDATION = 0;
const FOUNDATION_TOP_RANK = 5;
/** The column the off-suit card waits in. */
const COLUMN = 4;
/** The next rank up, of a different suit but the same color. */
const OFF_SUIT = "6C";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("refuses the next rank up when its suit is not the foundation's", async () => {
  openTable(h);
  poseFoundation(h, FOUNDATION, "spades", FOUNDATION_TOP_RANK);
  poseColumn(h, COLUMN, [OFF_SUIT]);
  const before = boardSpecs(h.snapshot());

  const accepted = h.debug.move("tableau", COLUMN, 0, "foundation", FOUNDATION);
  const after = boardSpecs(h.snapshot());
  await h.advance(1);
  captureStill(h, "refused");

  assertEqual(
    accepted,
    false,
    `move of ${OFF_SUIT} onto the spade foundation built to its ` +
      `${FOUNDATION_TOP_RANK}: the right rank, and not its suit ` +
      "(specs/foundations.md)",
  );
  assertDeepEqual(
    after,
    before,
    "the board after the refused move: the off-suit card is still in its " +
      "column and the foundation still holds five (specs/instrumentation.md)",
  );
});
