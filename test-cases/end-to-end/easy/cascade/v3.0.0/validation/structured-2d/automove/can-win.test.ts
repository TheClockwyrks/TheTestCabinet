// automove/can-win — the auto-move can win the game.
//
// specs/victory.md: the game is won the instant all `DECK_SIZE` (`52`) cards are on
// the foundations, each complete from its Ace to its King; the win is reached by
// whatever move put the last card home, and the game moves to the `won` screen on
// that move.
// specs/instrumentation.md: an accepted auto-move applies through the same path a
// released drop uses, so a board it completes wins.
//
// THE ROUTE IS THE SHORTEST ONE TO THE REQUIREMENT. The table is posed one card
// short of a win — fifty-one cards home and the King of spades alone in a column —
// and the auto-move is what plays it. Nothing here implements a player: the check
// does not deal, turn or play a game out. Win detection is left switched on, which
// is what a player gets, and it is the faculty this item is about.
//
// THE BOARD IS READ BEFORE ANY FRAME RUNS, so the fifty-two cards are counted where
// the winning move left them. The victory cascade begins on the cascade's first
// FRAME (specs/victory.md), which is the frame drawn afterwards for the picture, so
// a launched card cannot take a foundation's King away from this count.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  poseNearlyWon,
  siteOf,
  type Harness,
} from "../harness";

/** The suit held back at its Queen, whose King is the fifty-second card. */
const MISSING_SUIT = "spades";
const MISSING_TEXT = "KS";
/** The column that King waits in, where it is the lowest face-up card. */
const COLUMN = 0;
/** The cards a complete foundation holds, its Ace through its King. */
const COMPLETE = 13;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("wins the game when the auto-move puts the last card home", async () => {
  const pending = poseNearlyWon(h, { suit: MISSING_SUIT, column: COLUMN });

  const went = h.debug.autoMove("tableau", COLUMN);
  const after = h.snapshot();
  await h.advance(1);
  captureStill(h, "won");

  assertEqual(
    went,
    true,
    `autoMove("tableau", ${COLUMN}) with ${MISSING_TEXT} there and its suit ` +
      "built to the Queen (specs/instrumentation.md)",
  );
  assertEqual(
    siteOf(after, pending.id)?.pile,
    "foundation",
    `where ${MISSING_TEXT} ended up: on a foundation, which is the ` +
      "fifty-second card home (specs/victory.md)",
  );
  assertLength(
    after.foundations[pending.foundation],
    COMPLETE,
    `the cards on foundation ${pending.foundation}, complete from its Ace to ` +
      "its King (specs/victory.md)",
  );
  assertEqual(
    after.screen,
    "won",
    "the screen the instant all fifty-two cards were home (specs/victory.md)",
  );
});
