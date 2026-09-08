// Meltdown — screens/gameover-screen: the game-over screen reports the run it
// lost.
//
// THE RULE. `specs/screens.md`, on `victory` and `gameover`: both "draw the two
// rows of `ENDING_ITEMS`, `PLAY AGAIN` and `MENU`", and `gameover` reports "The
// final score and the wave reached."
//
// TWO FIGURES AND TWO ROWS, EACH ASSERTED SEPARATELY, so a build that reported the
// score and forgot the wave fails with the missing figure named.
//
// THE FIGURES ARE LOOKED FOR AS NUMBERS, not as strings, because
// `specs/screens.md` fixes the two menu ROWS as constants and fixes nothing about
// how a figure beside them is labelled: `WAVE REACHED 13`, `13` and `WAVE 13/20`
// all report the same run.
//
// WHY THIS IS A SEPARATE POINT FROM `screens.victory-screen`, and not the same
// check twice. The two screens report DIFFERENT things — the victory screen
// reports three figures and this one two — so a build that draws one report on
// both screens is right on one and wrong on the other, and the two must grade
// apart.
//
// THE DISTINGUISHING POSE. A lost run of Containment on MEDIUM, whose `20` waves
// `specs/modes.md` fixes, ended on wave `13` with a score of `640` and no lives.
// Every wrong model reads as a different number: a build reporting the run's TOTAL
// waves reads `20` and misses `13`; one reporting the score alone misses `13`; one
// reporting the wave alone misses `640`. The wave reached is deliberately not the
// last wave of the row, because a run that lost on its final wave could not tell
// the two apart.
//
// THE LIVES ARE POSED AT `0`, because that is the state a game over stands in —
// `specs/waves.md` ends the run when the lives reach `0`. `setLives` "triggers no
// game over ... this is a precondition" (`specs/instrumentation.md`), so posing it
// arranges the run rather than driving it. Nothing here reads the lives: the
// game-over screen is not asked to report them, and this check does not demand
// their absence either, because a build drawing `0` beside the score breaks no
// rule.
//
// ONLY THE REACTOR SIDE IS READ. `specs/floor.md` puts every readout in the
// panel's strip and forbids one on the floor, and the panel is drawn behind the
// end screens carrying the wave and the money already. Reading the whole stage
// would let the PANEL's own wave readout answer for a game-over screen that
// reported nothing, so the figures are looked for in the reactor region alone.
//
// THE SCREEN IS POSED. `setScreen` runs no entry effect
// (`specs/instrumentation.md`), which is what this point wants: a game-over screen
// standing over a run whose two figures this check chose. That a run out of lives
// OPENS this screen is `waves.game-over-at-zero-lives`'s reading, which row it
// opens on is `screens.play-again-focused`'s, and where each row leads is
// `screens.end-menu-returns-to-title`'s.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { ENDING_ITEMS, modeFigures } from "../constants";
import {
  captureStill,
  createHarness,
  startRun,
  type Harness,
} from "../harness";
import { drewText } from "../case-harness/index";
import { drewNumber, reactorTexts } from "./copy";

/** The row the lost run was played on. */
const MODE = "containment" as const;
const DIFFICULTY = "medium" as const;

/**
 * The wave the run reached.
 *
 * Short of the `20` that row runs to, so a build reporting the run's total wave
 * count reads a different number, and equal to no other figure posed here.
 */
const WAVE = 13;

/**
 * The score the lost run carries.
 *
 * Three digits, so no thousands separator can come into it, and equal to neither
 * the wave reached, the wave count, nor that row's starting money `250`.
 */
const SCORE = 640;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("draws the score, the wave reached and both rows", async () => {
  const { debug } = h;
  await startRun(h, MODE, DIFFICULTY);
  await debug.setWave(WAVE);
  await debug.setScore(SCORE);
  await debug.setLives(0);
  await debug.setScreen("gameover");

  const calls = await h.frameCalls();
  await captureStill(h, "gameover");

  const posed = await h.snapshot();
  assertEqual(posed.screen, "gameover", "the screen the report is read on");
  assertEqual(posed.wave, WAVE, "the wave the lost run is posed on");
  assertEqual(posed.score, SCORE, "the score the lost run is posed with");
  assertEqual(
    posed.waveCount,
    modeFigures(MODE, DIFFICULTY).waveCount,
    `the waves ${MODE} on ${DIFFICULTY} runs, which the wave reached is short of`,
  );

  for (const [row, item] of ENDING_ITEMS.entries()) {
    assertEqual(
      drewText(calls, item),
      true,
      `the game-over screen drew ${item}, row ${row} of ${ENDING_ITEMS.length}`,
    );
  }

  const runs = reactorTexts(calls);
  for (const [figure, value] of [
    ["the final score", SCORE],
    ["the wave reached", WAVE],
  ] as const) {
    assertEqual(
      drewNumber(runs, value),
      true,
      `the game-over screen reported ${figure} (${value}) somewhere on the ` +
        `reactor side of the stage; what it drew there was ` +
        `${JSON.stringify(runs)} (specs/screens.md)`,
    );
  }
});
