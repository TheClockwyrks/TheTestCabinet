// screens/resume-p — the pause key gives a paused game back.
//
// `specs/controls.md` gives the `pause` action two meanings: "Pause" while the
// game is being played, and "Resume the paused game" on a menu. `specs/ui.md`
// says the same from the screen's side: "Leaving this screen and pausing again
// each do what `RESUME` does", and `RESUME` "Returns to `playing` with the field
// and the run exactly as they stood."
//
// WHY IT IS A SEPARATE ITEM FROM `controls/pause-p`. Opening the pause menu and
// closing it again are two branches on two screens. A pause menu the key that
// opened it cannot dismiss is the classic half-wired pause, and a build with it
// should lose this point alone rather than the pause point as well.
//
// AND FROM `screens/resume-escape`. `pause` and `back` are two actions and two
// branches; `KeyP` raises `pause` alone, where `Escape` raises both at once.
//
// THE RUN IS POSED SO THAT RESUMING AND RESTARTING READ AS DIFFERENT NUMBERS, the
// same pose `screens/resume-returns-to-play` uses: a score, a ship count and a
// wave number no new game can have, and one rock at rest on the quiet ground.
//
// THE KEY IS DRIVEN THROUGH THE REGISTERED ACTION, so which key raises `pause`
// stays `controls/pause-p`'s point.
//
// WHAT THIS DOES NOT DECIDE. That the key PAUSES (`controls/pause-p`), that the
// field behind the menu is frozen (`screens/pause-freezes-the-field`), or what the
// menu's own `RESUME` entry does (`screens/resume-returns-to-play`).

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertLessThan } from "../assert";
import { QUIET_CORNER } from "../fixtures";
import { directDistance, driftOver } from "../geometry";
import {
  captureStill,
  createHarness,
  poseRock,
  requireRock,
  seconds,
  startPlaying,
  tapAction,
  ticksFor,
  type Harness,
} from "../harness";

/** The score the paused run is carrying: a figure no new game has. */
const POSED_SCORE = 4321;

/** The ships the paused run has left: fewer than the three a new game opens with. */
const POSED_LIVES = 2;

/** The wave the paused run reached: later than the wave 1 a new game opens on. */
const POSED_WAVE = 5;

/**
 * How far the resumed rock may have moved from where it was posed, in logical
 * units: the same bound `screens/resume-returns-to-play` derives, ten times the
 * distance the well moves a body at rest at `QUIET_CORNER` over one tick.
 */
const HELD_STILL = 10 * driftOver(QUIET_CORNER, seconds(1)) * seconds(1);

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

it("returns to playing with the run and the field exactly as they stood", async () => {
  startPlaying(h);
  h.debug.setScore(POSED_SCORE);
  h.debug.setLives(POSED_LIVES);
  h.debug.setWave(POSED_WAVE);
  const rockId = poseRock(h, "medium", QUIET_CORNER.x, QUIET_CORNER.y);
  h.debug.setScreen("paused");

  await h.advance(QUIET_TICKS);
  const before = h.snapshot();

  await tapAction(h, "pause");
  const after = h.snapshot();

  await h.advance(PICTURE_TICKS);
  captureStill(h, "resumed");

  assertEqual(
    before.screen,
    "paused",
    `the screen after ${String(QUIET_TICKS)} ticks on the pause menu with no ` +
      "key down — a paused game leaves the menu on a press (specs/ui.md)",
  );

  const took =
    "on the tick the pause action was raised on the pause menu — pausing " +
    "again does what RESUME does (specs/ui.md, specs/controls.md), where " +
    "RESTART would have opened a new game";

  assertEqual(after.screen, "playing", `the screen ${took}`);
  assertEqual(after.score, POSED_SCORE, `the score ${took}`);
  assertEqual(after.lives, POSED_LIVES, `the ships left ${took}`);
  assertEqual(after.wave, POSED_WAVE, `the wave number ${took}`);
  assertLength(after.rocks, 1, `the rocks on the field ${took}`);

  const rock = requireRock(
    after,
    rockId,
    `the rock the run was paused with, ${took}`,
  );
  assertLessThan(
    directDistance(rock, QUIET_CORNER),
    HELD_STILL,
    `how far the resumed rock stands from where the paused run left it, in ` +
      `logical units ${took}`,
  );
});
