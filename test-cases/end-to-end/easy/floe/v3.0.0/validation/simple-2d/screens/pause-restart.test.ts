// Floe — screens/pause-restart: confirming RESTART throws the run away and opens a
// new one.
//
// `specs/ui.md`, the `paused` row of the transitions table: "Confirm — ...
// `RESTART` starts a fresh run and opens `playing`", and, under the table,
// "Starting a run is what `specs/progression.md` fixes". That file fixes it: "A
// run opens at level `1` with `lives` at `START_LIVES` (`3`), the score at `0`,
// `reachedLevel` at `1`, the strait laid out for level `1`, all five bays open, no
// bonus catch out, and a fresh crossing under way."
//
// THE FOUR FIELDS THIS ITEM NAMES ARE THE FOUR A RESTART IS TOLD APART BY. The
// crossing is posed four levels in, on one life, with a score on the board and two
// bays filled, so each of the four readings is somewhere the crossing was not. A
// build that answered RESTART by simply resuming keeps all four of the posed
// values and fails all four readings; a build that opened a run but carried the
// old score into it fails exactly one. That is the grading this item is for, and
// it is why the pose is as far from a fresh run as a run gets.
//
// NO POSE CAN PRODUCE ANY OF IT. `setLevel` starts no run, `setScore` grants
// nothing and `setLives` ends none (`specs/instrumentation.md`), so the only thing
// that can open a run is the build's own start-a-run path. The confirm is a real
// key dispatched at the event target the engine listens on, and the entry it lands
// on is the second of `PAUSE_ITEMS`.
//
// WHAT IS NOT GRADED HERE. That the strait is laid out for level `1` and that a
// fresh crossing is under way belong to `screens.cross-starts-run` and to
// `progression`; that the pause key opens the menu at all is `controls.pause-p`;
// that the menu offers three entries is `screens.pause-menu`. This point asks only
// what the second entry did.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNotEqual } from "../assert";
import { BAY_COUNT, PAUSE_ITEMS, START_LIVES } from "../../src/constants";
import {
  captureStill,
  createHarness,
  startCrossing,
  type Harness,
} from "../harness";

/** The pause entry this transition belongs to: `RESTART`, the second. */
const RESTART_INDEX = 1;

/** The run that is thrown away, every figure away from a fresh run's. */
const LEVEL = 4;
const LIVES = 1;
const SCORE = 437;
const FILLED_BAYS = [0, 2] as const;

/** What a fresh run opens with (specs/progression.md). */
const FRESH_LEVEL = 1;
const FRESH_SCORE = 0;
const OPEN_BAYS: readonly boolean[] = Array.from(
  { length: BAY_COUNT },
  () => false,
);

/** One frame after the press, so the still shows the new run rather than the menu. */
const SETTLE_TICKS = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("opens a fresh level-1 run when RESTART is confirmed", async () => {
  startCrossing(h, LEVEL);
  h.debug.setScore(SCORE);
  h.debug.setLives(LIVES);
  for (const bay of FILLED_BAYS) h.debug.setBay(bay, true);
  h.debug.setScreen("paused");
  h.debug.setMenuIndex(RESTART_INDEX);

  const posed = h.snapshot();
  assertEqual(posed.screen, "paused", "the pose opened the pause menu");
  assertEqual(
    posed.menuIndex,
    RESTART_INDEX,
    `the pose highlighted ${PAUSE_ITEMS[RESTART_INDEX]}, the second entry`,
  );
  assertNotEqual(posed.level, FRESH_LEVEL, "a run several levels in");
  assertNotEqual(posed.lives, START_LIVES, "a run that has lost two lives");
  assertNotEqual(posed.score, FRESH_SCORE, "a score already on the board");
  assertNotEqual(
    posed.bays.filter((filled) => filled).length,
    0,
    "bays already filled",
  );

  await h.tap("Enter");
  await h.advance(SETTLE_TICKS);
  captureStill(h, "game");

  const run = h.snapshot();
  assertEqual(
    run.screen,
    "playing",
    `confirming ${PAUSE_ITEMS[RESTART_INDEX]} opens the playing screen (specs/ui.md)`,
  );
  assertEqual(
    run.level,
    FRESH_LEVEL,
    "a fresh run opens at level 1 (specs/progression.md)",
  );
  assertEqual(
    run.lives,
    START_LIVES,
    "with START_LIVES lives (specs/progression.md)",
  );
  assertEqual(run.score, FRESH_SCORE, "a score of 0 (specs/progression.md)");
  assertDeepEqual(
    run.bays,
    OPEN_BAYS,
    "and all five bays open (specs/progression.md)",
  );
});
