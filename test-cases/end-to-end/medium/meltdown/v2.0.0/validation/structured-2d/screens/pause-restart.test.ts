// Meltdown — screens/pause-restart: RESTART replays the run on the same mode and
// difficulty.
//
// THE RULE. specs/screens.md, `paused`: the `RESTART` row leads to "A fresh run of
// the same mode and difficulty, from its `opening` phase." specs/modes.md says
// what a fresh run is: "A run that has just started is in the `opening` phase on
// Wave 1, with its money at that row's starting money and its lives at that row's
// starting lives."
//
// TWO HALVES, AND A WRONG BUILD FAILS EITHER ONE. FRESH: the phase is `opening`,
// the wave is `1`, the money and lives are the pair's starting figures, and the
// floor the player had built is gone — a build that merely closes the menu leaves
// wave `5`, a dirtied purse and the old maze standing. THE SAME MODE AND
// DIFFICULTY: a build that restarts by returning to a default lands on Containment
// Medium, and this run is posed on Containment HARD precisely so that the default
// and the right answer are different values.
//
// THE POSED RUN IS DIRTIED ON PURPOSE. Its wave, money, score and lives are moved
// off every figure a fresh run carries, and a tower and a unit are put on the
// floor, so that "fresh" is a reading of what the restart DID rather than of what
// the pose happened to leave behind.
//
// THE STARTING FIGURES ARE READ OFF THE SNAPSHOT, not off `DIFFICULTY_TABLE`.
// `startMoney` and `startLives` are DERIVED from the mode and difficulty
// (specs/instrumentation.md), and whether a build derives them correctly is the
// `modes` group's item; this item asks only that the restart put the run back on
// them. So a build with a wrong table fails there and is judged here on the
// question this item names.
//
// THE PAUSE SCREEN IS POSED OUTRIGHT over the dirtied run, and the row is posed
// rather than walked. How the pause screen is reached is `controls.pause-key`'s
// requirement, and what PLAY AGAIN does on an end screen is
// `modes.replay-keeps-the-mode`'s — a different row on a different screen.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { PAUSE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  poseTarget,
  poseTower,
  startRun,
  tapAction,
  type Harness,
} from "../harness";

/** The row confirmed: `RESTART`, the second of the three `PAUSE_ITEMS`. */
const RESTART_ROW = PAUSE_ITEMS.indexOf("RESTART");

/**
 * The pair the run is played on: Containment at Hard.
 *
 * Hard is neither the difficulty a reset restores (`medium`,
 * specs/instrumentation.md) nor the one a build defaulting to the first row of
 * the list would land on, so a build that restarts onto a default reads a
 * different difficulty here.
 */
const MODE = "containment";
const DIFFICULTY = "hard";

/** Figures no fresh run carries, so "fresh" is read rather than assumed. */
const DIRTY_WAVE = 5;
const DIRTY_MONEY = 999;
const DIRTY_SCORE = 1234;
const DIRTY_LIVES = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("opens a fresh run on the same mode and difficulty when RESTART is confirmed", async () => {
  startRun(h, MODE, DIFFICULTY);
  h.debug.setWave(DIRTY_WAVE);
  h.debug.setMoney(DIRTY_MONEY);
  h.debug.setScore(DIRTY_SCORE);
  h.debug.setLives(DIRTY_LIVES);
  poseTower(h, "arc", 6, 6);
  poseTarget(h, "mote", 30, 24, 20);

  h.debug.setScreen("paused");
  h.debug.setMenuIndex(RESTART_ROW);
  await h.advance(1);

  const before = h.snapshot();
  assertEqual(before.screen, "paused", "the screen the scenario is posed on");
  assertEqual(
    before.menuIndex,
    RESTART_ROW,
    "the row the scenario is posed on",
  );
  assertEqual(before.mode, MODE, "the mode the paused run is on");
  assertEqual(
    before.difficulty,
    DIFFICULTY,
    "the difficulty the paused run is on",
  );
  assertEqual(before.wave, DIRTY_WAVE, "the wave the paused run had reached");
  assertLength(before.towers, 1, "the towers standing when the run was paused");
  assertLength(
    before.surge,
    1,
    "the units on the floor when the run was paused",
  );

  await tapAction(h, "confirm");
  captureStill(h, "restarted");

  const after = h.snapshot();
  assertEqual(after.mode, MODE, "the mode the restarted run is on");
  assertEqual(
    after.difficulty,
    DIFFICULTY,
    "the difficulty the restarted run is on",
  );
  assertEqual(
    after.screen,
    "playing",
    "the screen confirming RESTART leads to",
  );
  assertEqual(after.phase, "opening", "the phase a fresh run opens in");
  assertEqual(after.wave, 1, "the wave a fresh run opens on");
  assertEqual(
    after.money,
    after.startMoney,
    "the money a fresh run opens with, against the figure this pair derives",
  );
  assertEqual(
    after.lives,
    after.startLives,
    "the lives a fresh run opens with, against the figure this pair derives",
  );
  assertLength(after.towers, 0, "the towers standing on a fresh run's floor");
  assertLength(after.surge, 0, "the units on a fresh run's floor");
});
