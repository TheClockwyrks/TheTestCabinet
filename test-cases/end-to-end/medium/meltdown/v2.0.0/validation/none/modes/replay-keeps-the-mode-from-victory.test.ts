// modes/replay-keeps-the-mode-from-victory — PLAY AGAIN on the victory screen replays
// the mode and difficulty the run was on.
//
// THE RULE. `specs/screens.md`, for `victory`: PLAY AGAIN leads to "a fresh run on
// the mode and difficulty the run just played, with that pair's starting money and
// lives". `specs/modes.md` gives the pair's figures.
//
// ONE END SCREEN, BECAUSE THE TWO ARE TWO SCREENS. They are reached by different
// paths and are two cases of one branch, so a build that replays correctly from
// one and returns to the title from the other must not grade as one that gets
// neither. The other screen is `modes.replay-keeps-the-mode-from-gameover`'s.
//
// WHY THE ROW IS TAKEN AND NOT POSED. Replaying is an entry effect: it builds a
// run. `setScreen` runs none (`specs/instrumentation.md`), so the only way to see
// it is to take the row the way a player does — put the highlight on PLAY AGAIN
// and press `confirm`. The highlight is placed with `setMenuIndex` rather than
// walked there, because which row an end screen OPENS on is
// `screens.play-again-focused-on-victory`'s requirement and moving a highlight is
// `screens.menu-wrap`'s; a longer route here would only make this verdict less
// precise.
//
// TWO PAIRS, AND WHY EACH IS THERE. Both exercise this one screen's row the same
// way, and each is chosen so that a different way of losing the pair reads a
// different number:
//
//   CONTAINMENT AT HARD. The mode is the default one, so what is at stake is the
//   DIFFICULTY: a build that replayed on a fresh Containment reads Medium's `250`
//   money where Hard's row says `200`.
//
//   SUDDEN DEATH AT EASY. The difficulty is immaterial to this row, so what is at
//   stake is the MODE: a build that replayed on Containment reads `250` money and
//   `20` lives where the row says `300` and `1`. The difficulty is still carried
//   and still read, because a build that dropped it would be reporting a run it is
//   not on.
//
// THE RUN IS LEFT VISIBLY MID-PLAY before the row is taken — a stale money, a
// stale life count and a stale score, none of them any row's figure — so a build
// that changed the screen and left the run standing fails on the money rather than
// coinciding with it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  ENDING_ITEMS,
  modeFigures,
  type DifficultyId,
  type ModeId,
} from "../constants";
import {
  captureStill,
  createHarness,
  tapAction,
  type Harness,
} from "../harness";

/** Where PLAY AGAIN sits on both end screens (specs/screens.md). */
const PLAY_AGAIN_ROW = 0;

/** The screen the row is taken on. */
const SCREEN = "victory" as const;

/**
 * What the finished run is left carrying.
 *
 * None of the four is any row's starting money, starting lives or opening wave,
 * so nothing below can be satisfied by leaving the run where it stood. The wave
 * is there because "a FRESH run" is half of what the item asks for: a build that
 * carried the mode and the difficulty across but reopened on the wave the last
 * run died on has not replayed the run, it has resumed it.
 */
const STALE_MONEY = 7;
const STALE_LIVES = 13;
const STALE_SCORE = 4321;
const STALE_WAVE = 9;

/** The wave and the phase every run opens on (specs/waves.md, specs/modes.md). */
const OPENING_WAVE = 1;
const OPENING_PHASE = "opening";

/** The two pairs, chosen so each way of losing the pair reads a wrong figure. */
const PAIRS: readonly { mode: ModeId; difficulty: DifficultyId }[] = [
  { mode: "containment", difficulty: "hard" },
  { mode: "suddendeath", difficulty: "easy" },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("opens a fresh run on the same mode and difficulty from the victory screen", async () => {
  const { debug } = h;
  for (const { mode, difficulty } of PAIRS) {
    const figures = modeFigures(mode, difficulty);
    const where = `${ENDING_ITEMS[PLAY_AGAIN_ROW]} on ${SCREEN}, ${mode} at ${difficulty}`;

    await debug.reset();
    await debug.setMode(mode);
    await debug.setDifficulty(difficulty);
    // A run that was played: none of these is a figure any row opens on.
    await debug.setMoney(STALE_MONEY);
    await debug.setLives(STALE_LIVES);
    await debug.setScore(STALE_SCORE);
    await debug.setWave(STALE_WAVE);
    await debug.setScreen(SCREEN);
    await debug.setMenuIndex(PLAY_AGAIN_ROW);

    await tapAction(h, "confirm");
    await captureStill(h, "replay");

    const snapshot = await h.snapshot();
    assertEqual(snapshot.screen, "playing", `the screen after ${where}`);
    assertEqual(snapshot.mode, mode, `the mode after ${where}`);
    assertEqual(
      snapshot.difficulty,
      difficulty,
      `the difficulty after ${where}`,
    );
    assertEqual(snapshot.money, figures.startMoney, `the money after ${where}`);
    assertEqual(snapshot.lives, figures.startLives, `the lives after ${where}`);
    assertEqual(
      snapshot.wave,
      OPENING_WAVE,
      `the wave after ${where}, which a FRESH run opens on however far the ` +
        `finished one got (it was left on ${STALE_WAVE})`,
    );
    assertEqual(
      snapshot.phase,
      OPENING_PHASE,
      `the phase after ${where}, which a fresh run opens in`,
    );
  }
});
