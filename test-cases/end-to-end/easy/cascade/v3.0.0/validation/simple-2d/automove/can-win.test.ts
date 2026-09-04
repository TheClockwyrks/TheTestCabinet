// automove/can-win — the auto-move can win the game.
//
// specs/victory.md: the game is won the instant all fifty-two cards are on the
// foundations, the win is reached by whatever move put the last card home, and the
// game moves to the `won` screen on that move.
// specs/instrumentation.md: an accepted auto-move applies through the same path a
// released drop uses, so a board it completes wins.
//
// THE ROUTE IS THE SHORTEST ONE TO THE REQUIREMENT. The table is posed one card
// short of a win, fifty-one cards home and the King of spades alone in a column, and
// the auto-move is what plays it. Nothing here implements a player: the check does
// not deal, turn or play a game out. Win detection is left switched on, which is
// what a player gets, and it is the faculty this item is about.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  openTable,
  placeOf,
  poseNearlyWon,
  type Harness,
} from "../harness";

/** The card left off the foundations, waiting in a column. */
const MISSING = "KS";
/** The column it waits in, where it is the lowest face-up card. */
const COLUMN = 0;
/** The cards a complete foundation holds, Ace through King (specs/victory.md). */
const COMPLETE = 13;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("wins the game when the auto-move puts the last card home", async () => {
  openTable(h);
  const pending = poseNearlyWon(h, {
    missing: MISSING,
    pile: "tableau",
    index: COLUMN,
  });

  const went = h.debug.autoMove("tableau", COLUMN);
  const after = h.snapshot();
  await h.advance(1);
  captureStill(h, "won");

  assertEqual(
    went,
    true,
    `autoMove("tableau", ${COLUMN}) with ${MISSING} there and its suit built ` +
      "to the Queen (specs/instrumentation.md)",
  );
  assertEqual(
    placeOf(after, pending.id)?.pile,
    "foundation",
    `where ${MISSING} ended up: on a foundation, which is the fifty-second ` +
      "card home (specs/victory.md)",
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
