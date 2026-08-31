// Meltdown — screens/gameover-screen: the game-over screen reports the run.
//
// THE RULE. specs/screens.md, `victory` and `gameover`: `gameover` reports "The
// final score and the wave reached", and both screens "draw the two rows of
// `ENDING_ITEMS`, `PLAY AGAIN` and `MENU`".
//
// IT REPORTS LESS THAN THE VICTORY SCREEN, AND THAT IS WHY IT IS ITS OWN ITEM.
// specs/screens.md gives the two end screens different contents — the won run
// reports its lives, the lost one reports how far it got — so a build that draws
// one screen for both, or that reaches the loss screen with the win screen's
// figures, must grade differently from one that draws each as specified.
// `screens.victory-screen` reads the other.
//
// THE WAVE REACHED IS POSED AWAY FROM THE RUN'S LAST WAVE. A Containment Medium
// run counts `20` waves, and the loss here is posed on wave `13`: a build that
// reports the wave COUNT rather than the wave the run reached draws `20` and
// fails, which is exactly the confusion this reading exists to catch.
//
// THE FIGURES ARE READ AS NUMBERS, NOT AS STRINGS, because specs/screens.md fixes
// nothing about how the screen words what it reports. A number TOKEN is looked
// for, so a screen reading `875` is never accepted as a screen reading `13`.
//
// THE SCREEN IS POSED OUTRIGHT: `setScreen` "sets that field alone and runs no
// entry effect" (specs/instrumentation.md), and this item reads what the screen
// DRAWS from the figures the run left behind. That PLAY AGAIN is focused when the
// screen opens is `screens.play-again-focused`, which reaches the loss the way the
// run reaches it.

import { afterEach, beforeEach, it } from "vitest";
import { ENDING_ITEMS } from "../../src/constants";
import { assertEqual, assertNotEqual, assertTrue } from "../assert";
import { captureStill, createHarness, resetTo, type Harness } from "../harness";
import { readScreen, readsNumber, requireRun, textOf } from "./menu";

/** The score the lost run is left carrying: a figure nothing else on screen is. */
const SCORE = 875;

/** The wave the run got to: well short of a Containment Medium run's last. */
const WAVE_REACHED = 13;

/** The lives a lost run is left on (specs/waves.md: "Lives reaching `0`"). */
const LIVES = 0;

const MODE = "containment";
const DIFFICULTY = "medium";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the final score, the wave reached and both rows", async () => {
  resetTo(h);
  h.debug.setMode(MODE);
  h.debug.setDifficulty(DIFFICULTY);
  h.debug.setScreen("gameover");
  h.debug.setScore(SCORE);
  h.debug.setWave(WAVE_REACHED);
  h.debug.setLives(LIVES);
  h.debug.setMenuIndex(0);

  const runs = await readScreen(h);
  captureStill(h, "gameover");

  const posed = h.snapshot();
  assertEqual(posed.screen, "gameover", "the screen the scenario is posed on");
  assertNotEqual(
    posed.waveCount,
    WAVE_REACHED,
    "the run's wave count differs from the wave it reached, so the two readings " +
      "cannot be confused",
  );

  const drawn = textOf(runs).join(" | ");
  assertTrue(
    readsNumber(runs, SCORE),
    `the game-over screen draws the final score, ${SCORE}; it drew ${drawn}`,
  );
  assertTrue(
    readsNumber(runs, WAVE_REACHED),
    `the game-over screen draws the wave reached, ${WAVE_REACHED}; it drew ${drawn}`,
  );
  for (const item of ENDING_ITEMS) {
    requireRun(runs, item, "the game-over screen's menu");
  }
});
