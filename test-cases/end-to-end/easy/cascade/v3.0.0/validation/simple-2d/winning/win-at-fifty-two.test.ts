// winning/win-at-fifty-two — fifty-two cards home wins the game.
//
// THE RULE. specs/victory.md: "The game is won the instant all `DECK_SIZE` (`52`)
// cards are on the foundations, each foundation complete from its Ace to its King.
// The win is reached by whatever move put the last card home ... and the game moves
// to the `won` screen on that move." specs/instrumentation.md says the same of the
// state: "`screen` being `"won"` is the whole of the fact that the game is won, and
// the snapshot reports no second field for it."
//
// So the measurement is one direction of one rule: a board completed to fifty-two
// IS a win. The other direction — that fifty-one is not — is
// `winning/no-win-at-fifty-one`, and a build that got one right and the other wrong
// has to grade differently from one that got both wrong, which is why the two are
// separate points.
//
// THE WIN IS EARNED, NOT POSED. `setScreen("won")` would put the game on the won
// screen without winning anything, and `addCard` "touches no other pile and no
// other field" (specs/instrumentation.md), so neither runs the win test. The win
// test runs on a MOVE: "An accepted move applies through the same path a released
// drop uses, so a newly exposed column card turns and a completed board wins." So
// the fifty-second card is sent home through `move`, and what is read afterwards is
// the build's own rule reaching its own conclusion.
//
// "THE INSTANT" IS READ WITH NO FRAME ADVANCED. `move` is a pose applied between
// frames, so the snapshot taken straight after it is the state the move itself
// left. A build that only notices the win on some later frame's update has not won
// the game on the move that put the last card home, and is caught here.
//
// `launching` IS HELD OFF. The victory cascade begins with the win
// (specs/victory.md), and nothing about the cascade is this point's requirement:
// `winning/cascade-begins-on-win` decides that the cascade starts, and the whole
// `cascade` group decides how it runs. Gating it off (specs/instrumentation.md:
// "Off, no further card leaves the foundations") leaves the won screen showing the
// fifty-two cards the win was made of, which is what the captured picture is worth
// looking at. It cannot affect the reading: the gate holds the launch clock and
// nothing else, and the win test is `winDetect`'s, which is left ON because
// reaching the win is exactly the faculty this requirement exercises.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { DECK_SIZE } from "../constants";
import {
  captureStill,
  createHarness,
  openTable,
  poseNearlyWon,
  type Harness,
} from "../harness";

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("moves to the won screen on the move that puts the fifty-second card home", async () => {
  openTable(harness);
  harness.debug.setLaunching(false);
  const pending = poseNearlyWon(harness);

  const posed = harness.snapshot();
  assertEqual(
    posed.screen,
    "playing",
    "the screen with fifty-one cards home and one still to play, which is the " +
      "board this point then completes (specs/victory.md)",
  );
  assertLength(
    posed.foundations.flat(),
    DECK_SIZE - 1,
    "cards on the foundations before the last one is sent home " +
      "(specs/victory.md)",
  );

  const accepted = harness.debug.move(
    pending.from.pile,
    pending.from.index,
    pending.from.row,
    "foundation",
    pending.foundation,
  );
  const won = harness.snapshot();

  await harness.advance(1);
  captureStill(harness, "won");

  assertEqual(
    accepted,
    true,
    "move() to accept the last card of a suit onto that suit's foundation, " +
      "which is the move that completes the board (specs/foundations.md)",
  );
  assertLength(
    won.foundations.flat(),
    DECK_SIZE,
    "cards on the foundations once the last one has landed (specs/victory.md)",
  );
  assertEqual(
    won.screen,
    "won",
    "the screen the instant all fifty-two cards were on the foundations, read " +
      "on the move itself with no frame advanced (specs/victory.md)",
  );
});
