// Meltdown — screens/victory-screen: the victory screen reports the run it won.
//
// THE RULE. `specs/screens.md`, on `victory` and `gameover`: both "draw the two
// rows of `ENDING_ITEMS`, `PLAY AGAIN` and `MENU`", and `victory` reports "The
// final score, the waves survived, and the lives remaining."
//
// THREE FIGURES AND TWO ROWS, EACH ASSERTED SEPARATELY, so a build that reported
// the score and forgot the lives fails with the missing figure named rather than
// with "the victory screen is wrong".
//
// THE FIGURES ARE LOOKED FOR AS NUMBERS, not as strings. `specs/screens.md` fixes
// the two menu ROWS as constants and fixes not one thing about how a figure beside
// them is labelled or laid out — `LIVES REMAINING 7`, `7 LIVES LEFT` and `LIVES
// 7/20` all report the same run — so a check that demanded a wording would be
// grading copy the case never wrote.
//
// THE DISTINGUISHING POSE. A won run of Containment on EASY, which
// `specs/modes.md` gives `15` waves, carrying a score of `970` and `7` lives. All
// three figures differ from each other and from every other figure of that row, so
// each wrong model reads as a different number: a build reporting the score alone
// misses `15` and `7`; one reporting the wave the run STOOD on rather than the
// waves survived would read the same `15`, which is honest, because on a victory
// they are the same wave and the specification distinguishes them nowhere; one
// reporting the STARTING lives reads `20` and misses `7`; one drawing a hardcoded
// zero misses all three.
//
// WHY EASY AND NOT MEDIUM. Medium's wave count is `20`, which is also
// `START_LIVES` — the two figures under test would collide, and a build reporting
// its lives twice would pass the waves read. Easy's `15` collides with nothing.
//
// ONLY THE REACTOR SIDE IS READ. `specs/floor.md` puts every readout in the
// panel's strip and forbids one on the floor, and the panel is drawn behind the
// end screens — where it already carries the wave, the money and the lives. A
// check reading the whole stage would let the PANEL answer for a victory screen
// that reported nothing at all, so the figures are looked for in the reactor
// region alone, which is where `specs/screens.md`'s own screens are drawn.
//
// THE SCREEN IS POSED. `setScreen` "sets that field alone and runs no entry
// effect" (`specs/instrumentation.md`), which is exactly what this point wants: a
// victory screen standing over a run whose three figures this check chose. That
// the run's own last clear OPENS this screen is
// `waves.victory-on-clearing-the-final-wave`'s reading, and which row it opens on
// is `screens.play-again-focused`'s. Where each row leads is
// `screens.end-menu-returns-to-title`'s.
//
// THE FLOOR IS LEFT EMPTY, so nothing on it can draw a figure of its own into the
// region being read: `startRun` clears both rosters, and no tower and no unit
// stands to carry a label.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { ENDING_ITEMS, modeFigures } from "../constants";
import {
  captureStill,
  createHarness,
  drewText,
  startRun,
  type Harness,
} from "../harness";
import { drewNumber, reactorTexts } from "./copy";

/** The row the won run was played on: Containment at its easiest. */
const MODE = "containment" as const;
const DIFFICULTY = "easy" as const;

/** The waves survived: every wave of that row, which is what winning it means. */
const WAVES = modeFigures(MODE, DIFFICULTY).waveCount;

/**
 * The score the won run carries.
 *
 * Three digits, so no build's thousands separator can come into it, and equal to
 * no other figure this row fixes — not the waves, not the lives, not the starting
 * money `350`.
 */
const SCORE = 970;

/**
 * The lives left when it was won.
 *
 * Below `START_LIVES` (`20`), so a build reporting the STARTING lives reads a
 * different number, and unequal to the wave count, so neither figure can stand in
 * for the other.
 */
const LIVES = 7;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("draws the score, the waves survived, the lives remaining and both rows", async () => {
  const { debug } = h;
  await startRun(h, MODE, DIFFICULTY);
  await debug.setWave(WAVES);
  await debug.setScore(SCORE);
  await debug.setLives(LIVES);
  await debug.setScreen("victory");

  const calls = await h.frameCalls();
  await captureStill(h, "victory");

  const posed = await h.snapshot();
  assertEqual(posed.screen, "victory", "the screen the report is read on");
  assertEqual(
    posed.waveCount,
    WAVES,
    `the waves ${MODE} on ${DIFFICULTY} runs`,
  );
  assertEqual(posed.score, SCORE, "the score the won run is posed with");
  assertEqual(posed.lives, LIVES, "the lives the won run is posed with");

  for (const [row, item] of ENDING_ITEMS.entries()) {
    assertEqual(
      drewText(calls, item),
      true,
      `the victory screen drew ${item}, row ${row} of ${ENDING_ITEMS.length}`,
    );
  }

  const runs = reactorTexts(calls);
  for (const [figure, value] of [
    ["the final score", SCORE],
    ["the waves survived", WAVES],
    ["the lives remaining", LIVES],
  ] as const) {
    assertEqual(
      drewNumber(runs, value),
      true,
      `the victory screen reported ${figure} (${value}) somewhere on the reactor ` +
        `side of the stage; what it drew there was ` +
        `${JSON.stringify(runs)} (specs/screens.md)`,
    );
  }
});
