// instrumentation/win-detect-gate — `setWinDetect` gates the win, and nothing
// else.
//
// THE RULE. specs/instrumentation.md, under The faculty gates:
// `setWinDetect(enabled)` gates "the check that all fifty-two cards are home
// and the move to the `won` screen. Off, a board completed to fifty-two stays
// on `playing`." specs/victory.md is the faculty being gated: the game is won
// the instant all fifty-two cards are on the foundations, and it moves to `won`
// on that move.
//
// WHY A SCENARIO NEEDS THE GATE AT ALL. A check that wants a COMPLETED board
// without the game ending — a foundation holding its King, a table with nothing
// left to move — has no other way to build one: the fifty-second card home ends
// the game and starts a cascade over it. So the gate is read in both
// directions, over the SAME completing move on the SAME board: with it off the
// game stays on `playing`, with it on the same move reaches `won`. A build whose
// gate does nothing passes the second reading and fails the first; a build that
// never detects a win at all fails the second.
//
// THE COMPLETION IS THE GAME'S OWN. Fifty-one cards are posed home and the
// fifty-second is moved there by `move`, which applies through the same path a
// released drop uses (specs/instrumentation.md) — so what is gated is the check
// the real move runs, not a pose of the screen.
//
// THE READING IS TAKEN WITH NO FRAME ADVANCED, because the win is reached "by
// whatever move put the last card home" (specs/victory.md) rather than by a
// later frame noticing.
//
// WHAT IT DOES NOT DECIDE. That fifty-two cards home IS the win, and that
// fifty-one is not, are `winning.win-at-fifty-two` and
// `winning.no-win-at-fifty-one`. This point decides that the gate holds it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { DECK_SIZE } from "../constants";
import {
  captureStill,
  cardsHome,
  createHarness,
  poseNearlyWon,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves a completed board on the playing screen with the gate off", async () => {
  // Every foundation complete but one, its King waiting on an otherwise empty
  // table, one legal move from winning.
  const posed = poseNearlyWon(h);
  h.debug.setWinDetect(false);

  const accepted = h.debug.move(
    "tableau",
    posed.column,
    posed.row,
    "foundation",
    posed.foundation,
  );
  const after = h.snapshot();

  await h.advance(1);
  captureStill(h, "gated");

  assertEqual(
    accepted,
    true,
    `move() to accept the ${posed.suit} King onto its own foundation ` +
      "holding that suit's Queen (specs/foundations.md)",
  );
  assertEqual(
    cardsHome(after),
    DECK_SIZE,
    "cards on the four foundations once the last one was moved home",
  );
  assertEqual(
    after.screen,
    "playing",
    "the screen a board completed to fifty-two reached with " +
      "setWinDetect(false): off, it stays on playing " +
      "(specs/instrumentation.md)",
  );
});

it("reaches the won screen on the same completion with the gate on", async () => {
  const posed = poseNearlyWon(h);
  // The gate is left at the value `reset` restores, which is on
  // (specs/instrumentation.md); this reading is what makes the one above a
  // gate rather than a build that never detects a win.

  const accepted = h.debug.move(
    "tableau",
    posed.column,
    posed.row,
    "foundation",
    posed.foundation,
  );
  const after = h.snapshot();

  assertEqual(
    accepted,
    true,
    `move() to accept the ${posed.suit} King onto its own foundation ` +
      "holding that suit's Queen (specs/foundations.md)",
  );
  assertEqual(
    after.screen,
    "won",
    "the screen the same completion reached with the gate on: the game is " +
      "won the instant all fifty-two cards are home, and moves to won on " +
      "that move (specs/victory.md)",
  );
});
