// Floe — screens/victory-play-again: PLAY AGAIN on the victory screen opens a new
// run.
//
// `specs/ui.md`, the `victory`, `gameover` row of the transitions table: "Confirm
// — `PLAY AGAIN` starts a fresh run and opens `playing`; `MENU` returns to
// `title`", and, under the table, "Starting a run is what `specs/progression.md`
// fixes": "A run opens at level `1` with `lives` at `START_LIVES` (`3`), the score
// at `0`, ... all five bays open".
//
// FOUR OF THE FOUR END-SCREEN TRANSITIONS ARE FOUR POINTS. `PLAY AGAIN` and `MENU`
// are two transitions, and the victory screen and the game-over screen are two
// screens a build can get right on one and wrong on the other; each of the four
// poses its own screen and its own index, so none passes through another's screen
// on the way and a single dead entry costs a single point.
//
// THE RUN THIS ONE LEAVES IS A WON RUN, SO EVERY READING DISTINGUISHES. The
// victory screen is posed at `TOTAL_LEVELS`, where `specs/progression.md` wins the
// run, with a score on the board, two lives left and all five bays filled — which
// is the state the last hop of a run leaves. Each of the four readings below is
// therefore somewhere the ended run was not: a build that answered `PLAY AGAIN` by
// dropping the player back into the level they just won fails all four, and one
// that opened a run but carried the score across fails exactly one.
//
// NO POSE CAN PRODUCE ANY OF IT. `setLevel` starts no run, `setScore` grants
// nothing and `setBay` clears nothing (`specs/instrumentation.md`), so the only
// thing that can open a run is the build's own start-a-run path. The confirm is a
// real key dispatched at the event target the engine listens on, landing on the
// first entry of `ENDING_ITEMS`, which is where `specs/ui.md` opens every menu.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNotEqual } from "../assert";
import {
  BAY_COUNT,
  ENDING_ITEMS,
  START_LIVES,
  TOTAL_LEVELS,
} from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { poseEnding } from "./screens";

/** The ending entry this transition belongs to: `PLAY AGAIN`, the first. */
const PLAY_AGAIN_INDEX = 0;

/** The won run that is left behind: a full board at the last level. */
const SCORE = 437;
const LIVES = 2;

/** What a fresh run opens with (specs/progression.md). */
const FRESH_LEVEL = 1;
const FRESH_SCORE = 0;
const OPEN_BAYS: readonly boolean[] = Array.from(
  { length: BAY_COUNT },
  () => false,
);

/** One frame after the press, so the still shows the new run rather than the screen. */
const SETTLE_TICKS = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("opens a fresh level-1 run when PLAY AGAIN is confirmed on the victory screen", async () => {
  poseEnding(h, "victory", TOTAL_LEVELS);
  h.debug.setScore(SCORE);
  h.debug.setLives(LIVES);
  for (let bay = 0; bay < BAY_COUNT; bay += 1) h.debug.setBay(bay, true);
  h.debug.setMenuIndex(PLAY_AGAIN_INDEX);

  const posed = h.snapshot();
  assertEqual(posed.screen, "victory", "the pose opened the victory screen");
  assertEqual(
    posed.menuIndex,
    PLAY_AGAIN_INDEX,
    `the pose highlighted ${ENDING_ITEMS[PLAY_AGAIN_INDEX]}, the first entry`,
  );
  assertNotEqual(posed.level, FRESH_LEVEL, "a run won at the last level");
  assertNotEqual(posed.lives, START_LIVES, "a run that has lost a life");
  assertNotEqual(posed.score, FRESH_SCORE, "a score already on the board");
  assertDeepEqual(
    posed.bays,
    Array.from({ length: BAY_COUNT }, () => true),
    "and five filled bays",
  );

  await h.tap("Enter");
  await h.advance(SETTLE_TICKS);
  captureStill(h, "after");

  const run = h.snapshot();
  assertEqual(
    run.screen,
    "playing",
    `confirming ${ENDING_ITEMS[PLAY_AGAIN_INDEX]} opens the playing screen (specs/ui.md)`,
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
