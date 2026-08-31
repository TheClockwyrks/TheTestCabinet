// Meltdown — screens/pause-restart: RESTART replays the run.
//
// THE RULE. `specs/screens.md`, on `paused`'s three rows: `RESTART` leads to "A
// fresh run of the same mode and difficulty, from its `opening` phase."
// `specs/modes.md` says what a fresh run holds: "A run that has just started is in
// the `opening` phase on Wave 1, with its money at that row's starting money and
// its lives at that row's starting lives."
//
// TWO HALVES, AND BOTH ARE READ. It must be FRESH — the opening phase, Wave 1, and
// that row's starting money and lives — and it must be the SAME ROW. The run is
// therefore left visibly mid-play before the row is taken, on a wave past the
// first, with a money, a life count and a score that are no row's figure, so a
// build that merely changed the screen and left the run standing fails on the
// money rather than coinciding with it.
//
// CONTAINMENT AT HARD, BECAUSE HARD IS THE DISTINGUISHING ROW. `reset` puts the
// difficulty at `"medium"` (`specs/instrumentation.md`), so a build that replayed
// on a fresh Containment rather than on the row the run was on reads Medium's `250`
// money where Hard's row says `200`; Hard's money also differs from every other
// mode's starting sum, so a build that opened some other mode's run reads a
// different number again.
//
// THE ROW IS POSED, NOT WALKED. `setMenuIndex` sets the highlighted row outright
// (`specs/instrumentation.md`), so a build whose arrow keys are broken still gets a
// fair reading of where its RESTART row leads.
//
// WHAT THIS ITEM DOES NOT DECIDE. Replaying from an END screen is
// `modes.replay-keeps-the-mode`'s reading; this one is the pause menu's row. The
// derived figures of Containment at Hard are `modes.containment-hard`'s. And the
// floor a fresh run opens on is not asserted here: `specs/screens.md` fixes the
// phase, the wave and the pair's figures, and no spec sentence states what the
// rosters hold, so this check reads only what the specification fixes.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { PAUSE_ITEMS, modeFigures } from "../constants";
import {
  captureStill,
  createHarness,
  startRun,
  tapAction,
  type Harness,
} from "../harness";

/** The row confirmed: `RESTART`, the middle of the three `PAUSE_ITEMS`. */
const RESTART_ROW = 1;

/** The row the run is on, and the figures `specs/modes.md` gives it. */
const MODE = "containment";
const DIFFICULTY = "hard";
const FIGURES = modeFigures(MODE, DIFFICULTY);

/**
 * What the run is left carrying when it is paused.
 *
 * None of the four is any row's starting figure or a fresh run's opening wave, so
 * nothing asserted below can be satisfied by leaving the run where it stood.
 */
const STALE_WAVE = 5;
const STALE_MONEY = 7;
const STALE_LIVES = 13;
const STALE_SCORE = 4321;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("opens a fresh run of the same mode and difficulty when RESTART is confirmed", async () => {
  const { debug } = h;
  await startRun(h, MODE, DIFFICULTY);
  // A run that has been played: mid-progression, with figures no row opens on.
  await debug.setPhase("wave");
  await debug.setWave(STALE_WAVE);
  await debug.setMoney(STALE_MONEY);
  await debug.setLives(STALE_LIVES);
  await debug.setScore(STALE_SCORE);
  await debug.setScreen("paused");
  await debug.setMenuIndex(RESTART_ROW);
  await h.advance(1);

  const posed = await h.snapshot();
  assertEqual(posed.screen, "paused", "the screen the scenario is posed on");
  assertEqual(posed.menuIndex, RESTART_ROW, "the row the scenario is posed on");
  assertEqual(posed.wave, STALE_WAVE, "the wave the paused run stood on");
  assertEqual(posed.money, STALE_MONEY, "the money the paused run stood on");

  await tapAction(h, "confirm");
  await h.advance(1);
  await captureStill(h, "restarted");

  const after = await h.snapshot();
  const where = `${PAUSE_ITEMS[RESTART_ROW]}, row ${RESTART_ROW} of ${PAUSE_ITEMS.length} on the pause menu, on ${MODE} at ${DIFFICULTY}`;
  assertEqual(after.screen, "playing", `the screen after ${where}`);
  assertEqual(after.phase, "opening", `the phase the replayed run opens in, after ${where}`);
  assertEqual(after.wave, 1, `the wave the replayed run opens on, after ${where}`);
  assertEqual(after.mode, MODE, `the mode after ${where}`);
  assertEqual(after.difficulty, DIFFICULTY, `the difficulty after ${where}`);
  assertEqual(
    after.money,
    FIGURES.startMoney,
    `the money the replayed run opens with, after ${where}`,
  );
  assertEqual(
    after.lives,
    FIGURES.startLives,
    `the lives the replayed run opens with, after ${where}`,
  );
});
