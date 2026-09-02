// Floe — screens/gameover-play-again: PLAY AGAIN on the game-over screen opens a
// new run.
//
// `specs/ui.md`, the `victory`, `gameover` row of the transitions table: "Confirm
// — `PLAY AGAIN` starts a fresh run and opens `playing`", and, under the table,
// "Starting a run is what `specs/progression.md` fixes": "A run opens at level `1`
// with `lives` at `START_LIVES` (`3`), the score at `0`, ... all five bays open".
//
// THIS IS THE GAME-OVER SCREEN'S OWN POINT. `screens.victory-play-again` grades
// the same entry on the other end screen, and the two are two screens: a build
// commonly writes one end screen and copies it, and a copy that kept the other
// screen's handler is exactly the defect these two items tell apart. Each poses
// its own screen, so neither passes through the other's on the way.
//
// THE RUN THIS ONE LEAVES IS A LOST RUN, SO EVERY READING DISTINGUISHES. The
// screen is posed six levels in, with no lives left, a score on the board and two
// bays filled — the state `specs/progression.md` ends a run in. Each of the four
// readings below is somewhere that run was not, so a build that dropped the player
// back into the level they lost fails all four, and one that opened a run but
// carried the score across fails exactly one.
//
// NO POSE CAN PRODUCE ANY OF IT. `setLevel` starts no run, `setLives` ends none and
// `setScore` grants nothing (`specs/instrumentation.md`), so the only thing that
// can open a run is the build's own start-a-run path — including from `lives` at
// `0`, which is where a game-over screen always sits and which
// `specs/progression.md` says the fresh run must lift back to `START_LIVES`. The
// confirm is a real key dispatched at the event target the engine listens on,
// landing on the first entry of `ENDING_ITEMS`.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNotEqual } from "../assert";
import { BAY_COUNT, ENDING_ITEMS, START_LIVES } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { poseEnding } from "./screens";

/** The ending entry this transition belongs to: `PLAY AGAIN`, the first. */
const PLAY_AGAIN_INDEX = 0;

/** The lost run that is left behind: six levels in, out of lives. */
const REACHED_LEVEL = 6;
const SCORE = 472;
const LIVES = 0;
const FILLED_BAYS = [0, 3] as const;

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

it("opens a fresh level-1 run when PLAY AGAIN is confirmed on the game-over screen", async () => {
  poseEnding(h, "gameover", REACHED_LEVEL);
  h.debug.setReachedLevel(REACHED_LEVEL);
  h.debug.setScore(SCORE);
  h.debug.setLives(LIVES);
  for (const bay of FILLED_BAYS) h.debug.setBay(bay, true);
  h.debug.setMenuIndex(PLAY_AGAIN_INDEX);

  const posed = h.snapshot();
  assertEqual(posed.screen, "gameover", "the pose opened the game-over screen");
  assertEqual(
    posed.menuIndex,
    PLAY_AGAIN_INDEX,
    `the pose highlighted ${ENDING_ITEMS[PLAY_AGAIN_INDEX]}, the first entry`,
  );
  assertNotEqual(posed.level, FRESH_LEVEL, "a run several levels in");
  assertNotEqual(posed.lives, START_LIVES, "a run out of lives");
  assertNotEqual(posed.score, FRESH_SCORE, "a score already on the board");
  assertNotEqual(
    posed.bays.filter((filled) => filled).length,
    0,
    "and bays already filled",
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
