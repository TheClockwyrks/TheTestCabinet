// instrumentation/win-detect-gate — `setWinDetect(false)` holds the win back, and
// turning it back on lets the game be won.
//
// specs/instrumentation.md: `setWinDetect(enabled)` "gates the check that all
// fifty-two cards are home and the move to the `won` screen. Off, a board completed
// to fifty-two stays on `playing`." specs/victory.md is the rule it gates: the game
// is won the instant all fifty-two cards are on the foundations, and it moves to
// the `won` screen on the move that put the last card home.
//
// WHY THE SUITE RESTS ON IT. A check that wants a nearly-complete board and one
// more move, without the victory cascade launching fifty-two cards across the
// reading it is taking, turns this gate off. A gate that did nothing would end
// every one of those scenarios in a cascade.
//
// TWO CHECKS, because the two failures are different builds: one whose gate does
// nothing passes the second and fails the first, and one that never detects a win
// passes the first and fails the second. The board and the move are identical in
// both, so the pair reads the gate and nothing else.
//
// THE BOARD IS COMPLETED BY A REAL MOVE. `poseNearlyWon` puts fifty-one cards home
// and leaves the fifty-second on a column, and the check sends it home through
// `move`, which "applies through the same path a released drop uses, so [...] a
// completed board wins" (specs/instrumentation.md). Posing the fifty-second card
// straight onto its foundation with `addCard` would ask a different question: that
// operation is a pose and runs no rule.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { DECK_SIZE } from "../constants";
import {
  captureStill,
  createHarness,
  openTable,
  poseNearlyWon,
  tableCards,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/** Pose a board one card short of a win with the gate as given, and send it home. */
function completeWithGate(winDetect: boolean): void {
  openTable(h);
  h.debug.setWinDetect(winDetect);
  const pending = poseNearlyWon(h);

  const accepted = h.debug.move(
    pending.from.pile,
    pending.from.index,
    pending.from.row,
    "foundation",
    pending.foundation,
  );
  assertEqual(
    accepted,
    true,
    "move must accept the last card of a suit onto that suit's foundation " +
      "(specs/foundations.md)",
  );
  assertLength(
    tableCards(h.snapshot()),
    DECK_SIZE,
    "the cards on the table once the last one has been sent home",
  );
}

it("stays on the playing screen with the gate off", async () => {
  completeWithGate(false);
  const after = h.snapshot();

  // The completed board still on the playing screen.
  await h.advance(1);
  captureStill(h, "gated");

  assertEqual(
    after.screen,
    "playing",
    "the screen a board completed to fifty-two reaches with " +
      "setWinDetect(false) (specs/instrumentation.md)",
  );
  assertLength(
    after.foundations.flat(),
    DECK_SIZE,
    "the cards on the foundations, which are all fifty-two",
  );
});

it("reaches the won screen with the gate on", async () => {
  completeWithGate(true);
  const after = h.snapshot();

  await h.advance(1);

  assertEqual(
    after.screen,
    "won",
    "the screen a board completed to fifty-two reaches with winDetect on: " +
      "the game is won the instant every card is home (specs/victory.md)",
  );
});
