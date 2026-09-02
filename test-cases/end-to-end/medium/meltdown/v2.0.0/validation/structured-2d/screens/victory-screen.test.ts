// Meltdown — screens/victory-screen: the victory screen reports the run.
//
// THE RULE. specs/screens.md, `victory` and `gameover`: `victory` reports "The
// final score, the waves survived, and the lives remaining", and both screens
// "draw the two rows of `ENDING_ITEMS`, `PLAY AGAIN` and `MENU`".
//
// FIVE READINGS OF ONE SCREEN, and each is a different wrong build: a build that
// reports no score leaves the player with nothing to have played for; one that
// reports no wave count or no lives has dropped half of what the win was; one
// missing a row has a screen the player cannot leave by the route it names.
//
// THE FIGURES ARE READ AS NUMBERS, NOT AS STRINGS. specs/screens.md fixes nothing
// about how the screen words or formats what it reports — `SCORE 875`, `875 PTS`
// and `Final score: 875` are all the requirement met — so a number TOKEN is looked
// for in some run of text. A token, so a screen reading `875` is never accepted as
// a screen reading `7`.
//
// THE THREE FIGURES ARE POSED APART FROM EACH OTHER on purpose: `875`, `20` and
// `7` cannot be confused, so a screen carrying all three has drawn three separate
// readouts, and a build that draws the score three times over carries only one of
// them.
//
// THE WAVES SURVIVED IS `20` BOTH WAYS ROUND. A victory is reached by clearing the
// last wave (specs/waves.md), so the run's current wave and the run's wave count
// are the same number on this screen — Containment Medium's `20`, as
// specs/modes.md gives it. The scenario poses the wave AT that figure, so a build
// reporting either of them draws the same number and neither is being demanded
// over the other.
//
// THE SCREEN IS POSED OUTRIGHT. specs/instrumentation.md's `setScreen` "sets that
// field alone and runs no entry effect", and no entry effect is what this item is
// about: it reads what the screen DRAWS from the figures the run left behind.
// That PLAY AGAIN is the row focused when the screen opens is
// `screens.play-again-focused`, which reaches the transition the way the run
// reaches it, and where the rows lead is `screens.end-menu-returns-to-title` and
// `modes.replay-keeps-the-mode`.

import { afterEach, beforeEach, it } from "vitest";
import { ENDING_ITEMS } from "../constants";
import { assertEqual, assertTrue } from "../assert";
import { captureStill, createHarness, resetTo, type Harness } from "../harness";
import { readScreen, readsNumber, requireRun, textOf } from "./menu";

/** The score the won run is left carrying: a figure nothing else on screen is. */
const SCORE = 875;

/** The lives left in hand: a figure that is neither a default nor a boundary. */
const LIVES = 7;

/** The mode and difficulty the run was played on, and the wave it was won on. */
const MODE = "containment";
const DIFFICULTY = "medium";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the final score, the waves survived, the lives left and both rows", async () => {
  resetTo(h);
  h.debug.setMode(MODE);
  h.debug.setDifficulty(DIFFICULTY);
  h.debug.setScreen("victory");
  h.debug.setScore(SCORE);
  h.debug.setLives(LIVES);

  // The wave a Containment Medium run is won on is its last, and `waveCount` is
  // DERIVED from the pair (specs/modes.md), so it is read off the snapshot rather
  // than written here: whether a build derives it correctly is the `modes` group's
  // item, and this one asks only that the screen report it.
  const waves = h.snapshot().waveCount;
  h.debug.setWave(waves);
  h.debug.setMenuIndex(0);

  const runs = await readScreen(h);
  captureStill(h, "victory");

  assertEqual(
    h.snapshot().screen,
    "victory",
    "the screen the scenario is posed on",
  );

  const drawn = textOf(runs).join(" | ");
  assertTrue(
    readsNumber(runs, SCORE),
    `the victory screen draws the final score, ${SCORE}; it drew ${drawn}`,
  );
  assertTrue(
    readsNumber(runs, waves),
    `the victory screen draws the waves survived, ${waves}; it drew ${drawn}`,
  );
  assertTrue(
    readsNumber(runs, LIVES),
    `the victory screen draws the lives remaining, ${LIVES}; it drew ${drawn}`,
  );
  for (const item of ENDING_ITEMS) {
    requireRun(runs, item, "the victory screen's menu");
  }
});
