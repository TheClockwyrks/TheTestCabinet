// progression/game-over-reports-level — the game-over screen names the level the
// run REACHED, not the level it happened to be standing on.
//
// specs/progression.md: "`lives` at `0`: the run is over and the screen becomes
// `gameover`, reporting `reachedLevel`." specs/ui.md fixes it again from the
// screens' side: `gameover` shows "The final score, the level reached
// (`reachedLevel`), and a menu of `ENDING_ITEMS`".
//
// THE TWO LEVELS ARE POSED APART, and that is the whole design of this point.
// `level` and `reachedLevel` are two fields with two operations
// (specs/instrumentation.md gives `setReachedLevel(n)` the job of setting "the
// level the game-over screen reports"), and in an unposed run they hold the same
// number — so a screen posed at one value alone would read the same digit whether
// the build printed the right field or the wrong one. Posed at `POSED_LEVEL` (3)
// and `REACHED_LEVEL` (6) the two models print different digits, and a failure
// names which field the build reached for.
//
// THE SCREEN IS READ, NOT THE SNAPSHOT. That `setReachedLevel` reads back is
// `instrumentation/state-run`'s requirement; this point is about what the
// player is SHOWN, so it reads the runs of text the frame actually drew.
//
// ONLY WHAT WAS DRAWN OVER THE STRAIT COUNTS. specs/strait.md divides the stage
// into the HUD bar over `y` in `[0, HUD_H]` and the strait below it, and
// specs/ui.md puts the six screens on the strait. A build is free to keep drawing
// its HUD under an end screen, and the HUD carries a `LEVEL` readout of its own —
// so a check that read the whole frame could credit the end screen with a figure
// the HUD printed. The runs are therefore filtered by where they were anchored.
//
// THE FIGURE IS READ AS A NUMBER. specs/ui.md fixes what the screen reports and
// leaves how it is set to the build, so the check asks whether some run of the
// screen's copy carries the level reached as a figure of its own, however that
// figure is set. A `6` inside a score of `1650` is a different number and does
// not answer for it (a letter boundary is no boundary at all: coalesced runs
// spell a label and its figure as `LEVEL6`). The score is posed to `POSED_SCORE`,
// which carries neither digit at all, so nothing else on the screen can supply or
// mask one.
//
// It does NOT require the current level to be absent from the screen. specs/ui.md
// fixes what the screen must report and leaves its layout to the build, and a
// build that printed both would still have reported the level reached.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import { HUD_H } from "../constants";
import {
  captureStill,
  createHarness,
  drawnTextRuns,
  startCrossing,
  type DrawCall,
  type Harness,
} from "../harness";

/** The level the strait stands at, and the level the run reached. Different. */
const POSED_LEVEL = 3;
const REACHED_LEVEL = 6;

/**
 * The score the screen also reports.
 *
 * Its digits are `1`, `2`, `5` and `0`, so neither posed level's digit appears
 * anywhere in it and the token match below cannot be fed or starved by it.
 */
const POSED_SCORE = 1250;

/**
 * Every logical run of text the frame spelled over the strait, where the screens
 * are drawn — the runs, not the `fillText` calls, so a figure letter-spaced a
 * glyph per call is read as the figure it spells.
 */
function screenRuns(calls: readonly DrawCall[]): string[] {
  return drawnTextRuns(calls)
    .filter((draw) => draw.y >= HUD_H)
    .map((draw) => draw.text);
}

/**
 * The separators a build may set between a figure's digit triples.
 *
 * `Number.prototype.toLocaleString` groups by default, so a build that reaches for
 * it reports the score as `1,250`, and another locale's grouping gives `1'250` or
 * `1\u202F250`. Every one of those reports the one figure, and each separator is
 * dropped before the digits are read.
 *
 * THE ASCII SPACE IS DELIBERATELY NOT ONE OF THEM. A run of the screen's copy
 * carries a label and often more than one figure, separated by exactly that, so
 * accepting it would read the `40` and the `130` of "LEVEL 40  SCORE 130" as the
 * single figure `40130`. `.` is left out for its own reason: it is the decimal
 * point, and a build drawing `1.5` means one and a half.
 */
const GROUP = "[,'\\u00A0\\u202F\\u2009]";

/**
 * One figure as a build may have set it: grouped, or plain.
 *
 * NO SIGN IS READ. Every figure this case reads as a number is a count — a
 * score, a level, a tally of lives, the seconds left — and not one of them can
 * be negative, so a hyphen against the digits is a separator a build set between
 * a label and its figure rather than a minus. Taking it for a minus would lose
 * the figure a build drawing `FINAL SCORE-472` plainly reports, and could gain
 * nothing in exchange: no reading in this suite looks for a negative number.
 */
const DRAWN = new RegExp(
  `\\d{1,3}(?:${GROUP}\\d{3})+(?:\\.\\d+)?|\\d+(?:\\.\\d+)?`,
  "g",
);

/**
 * Whether some run of that text carries `figure` as a figure of its own.
 *
 * A FIGURE IS READ AS A NUMBER, NOT AS A STRING. specs/ui.md fixes WHAT the
 * screen reports and leaves how it is set to the build, so a level reached of `6`
 * is reported by `6` and by an arcade's zero-padded `06` alike, while the `6`
 * inside a score of `1250` is a different number and answers for neither. Each
 * run is read on its own, so two runs are never joined into a figure neither of
 * them drew, and `LEVEL6` yields `6`: the runs are coalesced verbatim, so a label
 * and its figure drawn a measured space apart spell one run with no space
 * between them.
 */
function names(runs: readonly string[], figure: number): boolean {
  return runs.some((run) =>
    (run.match(DRAWN) ?? []).some(
      (drawn) => Number(drawn.replace(new RegExp(GROUP, "g"), "")) === figure,
    ),
  );
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("names the level the run reached on the game-over screen", async () => {
  await startCrossing(h, POSED_LEVEL);
  await h.debug.setScore(POSED_SCORE);
  await h.debug.setReachedLevel(REACHED_LEVEL);
  await h.debug.setScreen("gameover");

  const posed = await h.snapshot();
  assertEqual(posed.screen, "gameover", "the screen the reading is taken on");
  assertEqual(posed.level, POSED_LEVEL, "the level the strait stands at");
  assertEqual(
    posed.reachedLevel,
    REACHED_LEVEL,
    "the level the run reached, posed apart from the level it stands at",
  );

  const runs = screenRuns(await h.frameCalls());
  await captureStill(h, "gameover");

  assertTrue(
    names(runs, REACHED_LEVEL),
    `the game-over screen to report reachedLevel (${REACHED_LEVEL}) as a ` +
      `figure of its own (specs/progression.md); it drew ` +
      `${JSON.stringify(runs.join(" | "))}`,
  );
});
