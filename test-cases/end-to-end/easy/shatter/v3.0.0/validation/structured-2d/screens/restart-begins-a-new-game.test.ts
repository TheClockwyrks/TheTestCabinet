// screens/restart-begins-a-new-game — RESTART throws the run away and opens a
// new game.
//
// `specs/ui.md` gives the pause menu's second entry, `RESTART`, one effect: it
// "Opens a new game, as `specs/progression.md` states, and moves to `playing`."
// `specs/progression.md` states what a new game is: "A new game begins with
// `START_LIVES` (`3`) ships, counting the one being flown, a score of `0`, and
// wave `1`."
//
// THE RUN IS POSED SO THAT RESTARTING AND RESUMING READ AS DIFFERENT NUMBERS.
// The other entry of this menu that leads back to `playing` is `RESUME`, which
// hands the field and the run back exactly as they stood. So the game is paused
// carrying a score and TWO ships — figures a new game cannot have — and the
// reading after the press says which of the two the build did: a build that
// resumed reads back `4321` and `2`, and only a build that OPENED A GAME reads
// back `0` and `START_LIVES`. That is the whole reason this check poses a run
// at all.
//
// THE ENTRY IS POSED, NOT WALKED TO. `setMenuIndex(1)` puts the highlight on
// `RESTART` outright (`specs/instrumentation.md`), so a build with a broken menu
// key loses `controls/menu-*` rather than this point as well.
//
// THE ENTRY IS CONFIRMED THROUGH THE REGISTERED ACTION, because which key
// confirms is `controls/confirm-enter`'s and `controls/confirm-space`'s.
//
// AND THE NEW GAME IS THE PRESS'S DOING. A quarter second runs on the pause
// screen with nothing down and the run is read at the end of it, so a build
// that clears a score behind its own pause menu is caught there rather than
// passing here.
//
// THE WORLD IS THE QUIET ONE `startPlaying` LEAVES, with the wave loop, the
// saucer's arrival and the ship's lethal contact off, so nothing but the press
// can reach the three readings. What a new game LAYS on the field is
// `waves/wave-one-spawns-four`'s point, not this one.
//
// WHAT THIS DOES NOT DECIDE. What the menu shows
// (`screens/pause-menu-entries`), the other two entries
// (`screens/resume-returns-to-play`, `screens/quit-returns-to-the-title`), and
// the opening wave (`waves/*`).

import { afterEach, beforeEach, it } from "vitest";
import { PAUSE_ITEMS, START_LIVES } from "../../src/constants";
import { assertEqual } from "../assert";
import { QUIET_CORNER } from "../fixtures";
import {
  captureStill,
  createHarness,
  poseRock,
  startPlaying,
  tapAction,
  ticksFor,
  type Harness,
} from "../harness";

/** The entry the highlight is posed on: `RESTART`, the second of `PAUSE_ITEMS`. */
const RESTART = 1;

/** The score the paused run is carrying: a figure no new game has. */
const POSED_SCORE = 4321;

/** The ships the paused run has left: fewer than the three a new game opens with. */
const POSED_LIVES = 2;

/** The wave the paused run reached: later than the wave 1 a new game opens on. */
const POSED_WAVE = 5;

/** The quiet stretch driven on the pause screen before the press, in ticks. */
const QUIET_TICKS = ticksFor(0.25);

/** Frames driven after the press for the still alone, in ticks. */
const PICTURE_TICKS = ticksFor(0.25);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("opens a new game with START_LIVES ships and no score when RESTART is confirmed", async () => {
  // A run in progress: a score, two ships, wave 5, and one rock still up.
  startPlaying(h);
  h.debug.setScore(POSED_SCORE);
  h.debug.setLives(POSED_LIVES);
  h.debug.setWave(POSED_WAVE);
  poseRock(h, "medium", QUIET_CORNER.x, QUIET_CORNER.y);

  h.debug.setScreen("paused");
  h.debug.setMenuIndex(RESTART);

  await h.advance(QUIET_TICKS);
  const before = h.snapshot();

  await tapAction(h, "confirm");
  const after = h.snapshot();

  await h.advance(PICTURE_TICKS);
  captureStill(h, "restarted");

  assertEqual(
    before.screen,
    "paused",
    `the screen after ${String(QUIET_TICKS)} ticks on the pause menu with no ` +
      "key down — a paused game leaves the menu on a confirmed entry " +
      "(specs/ui.md)",
  );
  assertEqual(
    before.score,
    POSED_SCORE,
    "the score the run was paused carrying, still standing when the press " +
      "was taken — a paused game advances nothing (specs/ui.md)",
  );
  assertEqual(
    before.lives,
    POSED_LIVES,
    "the ships the run was paused carrying, still standing when the press " +
      "was taken — a paused game advances nothing (specs/ui.md)",
  );

  const took = `on the tick confirm was pressed with the pause menu on entry ${String(RESTART)}, ${JSON.stringify(PAUSE_ITEMS[RESTART])} — RESTART opens a new game and moves to playing (specs/ui.md), where RESUME would have handed the run back as it stood`;

  assertEqual(after.screen, "playing", `the screen ${took}`);
  assertEqual(
    after.score,
    0,
    `the score of the game RESTART opened, having been posed at ` +
      `${String(POSED_SCORE)} beforehand — a new game begins with a score of ` +
      `0 (specs/progression.md), ${took}`,
  );
  assertEqual(
    after.lives,
    START_LIVES,
    `the ships the game RESTART opened has, having been posed at ` +
      `${String(POSED_LIVES)} beforehand — a new game begins with START_LIVES ` +
      `ships, counting the one being flown (specs/progression.md), ${took}`,
  );
});
