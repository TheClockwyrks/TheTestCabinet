// Wireworm — screens/pause-restart: confirming RESTART opens a new run.
//
// specs/ui.md's `paused` menu: `RESTART`, the second entry of `PAUSE_ITEMS`,
// "Opens a new run, at level `1` with `START_LIVES` lives and a score of `0`,
// and moves to `playing`." So that the restart has something to undo, the run it
// is confirmed from is posed well away from every one of those four values: a
// board at `POSED_LEVEL` with `POSED_LIVES` life and `POSED_SCORE` on the board.
// A build that resumes instead of restarting reads back the posed run; a build
// that restarts reads back the new one.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { PAUSE_ITEMS, START_LIVES } from "../constants";
import {
  captureStill,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";
import { CONFIRM_KEY, pauseLiveBoard } from "./screens";

/** Which entry of `PAUSE_ITEMS` is `RESTART`. */
const RESTART_ITEM = PAUSE_ITEMS.indexOf("RESTART");

/**
 * The run the restart is confirmed from.
 *
 * Level 5 is not 1, one life is neither `START_LIVES` (`3`) nor `0`, and 4,720
 * is not `0`, so every field the new run fixes reads as a different number from
 * the one it replaced and no field can pass by having been right already.
 */
const POSED_LEVEL = 5;
const POSED_LIVES = 1;
const POSED_SCORE = 4720;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("opens a run at level 1 with three lives and no score on RESTART", async () => {
  await startPlaying(h, { level: POSED_LEVEL });
  await h.debug.setLives(POSED_LIVES);
  await h.debug.setScore(POSED_SCORE);
  await pauseLiveBoard(h, RESTART_ITEM);

  await h.tap(CONFIRM_KEY);
  await captureStill(h, "restarted");

  const restarted = await h.snapshot();
  assertEqual(restarted.screen, "playing", "the screen RESTART opened");
  assertEqual(restarted.level, 1, "the level of the run RESTART began");
  assertEqual(restarted.lives, START_LIVES, "the lives RESTART began with");
  assertEqual(restarted.score, 0, "the score RESTART began with");
});
