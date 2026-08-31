// screens/resume-returns-to-play — RESUME gives the game back exactly as it
// stood.
//
// `specs/ui.md` gives the pause menu's first entry, `RESUME`, one effect: it
// "Returns to `playing` with the field and the run exactly as they stood."
//
// THE RUN IS POSED SO THAT RESUMING AND RESTARTING READ AS DIFFERENT NUMBERS.
// The other entry of this menu that leads back to `playing` is `RESTART`, which
// opens a NEW game — score `0`, `START_LIVES` ships, wave `1`, and a field
// cleared and relaid (`specs/progression.md`). So the game is paused carrying a
// score, a ship count and a wave number that a new game cannot have, and one
// rock the player has not shot down. A build that confirmed entry `0` and
// restarted therefore fails on every reading below rather than passing on the
// screen alone, and the failure names which of the two it did.
//
// THE ROCK IS POSED AT REST ON THE QUIET GROUND, `fixtures.ts`'s `QUIET_CORNER`,
// `412` units from the star where the well pulls at some `26` units per second
// squared. That is what lets "exactly as they stood" be read as a POSITION
// rather than as a count: resuming hands the field back to the simulation, so
// the one frame that carries the press is worth one real tick of play, and the
// well moves a body at rest there by under two thousandths of a unit over it.
// The tolerance below is that figure with room to spare, and it is some four
// orders of magnitude under the distance a relaid field would put the rock at.
//
// THE ENTRY IS CONFIRMED THROUGH THE REGISTERED ACTION, because which key
// confirms is `controls/confirm-enter`'s and `controls/confirm-space`'s.
//
// AND THE RETURN IS THE PRESS'S DOING. A quarter second runs on the pause
// screen with nothing down and the screen is read at the end of it, so a build
// whose pause menu falls back into play on its own is caught there.
//
// WHAT THIS DOES NOT DECIDE. That the field behind the menu is frozen
// (`screens/pause-freezes-the-field`), what the menu shows
// (`screens/pause-menu-entries`), and the other two entries
// (`screens/restart-begins-a-new-game`, `screens/quit-returns-to-the-title`).

import { afterEach, beforeEach, it } from "vitest";
import { PAUSE_ITEMS } from "../../src/constants";
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

/** The entry the highlight is posed on: `RESUME`, the first of `PAUSE_ITEMS`. */
const RESUME = 0;

/** The score the paused run is carrying: a figure no new game has. */
const POSED_SCORE = 4321;

/** The ships the paused run has left: fewer than the three a new game opens with. */
const POSED_LIVES = 2;

/** The wave the paused run reached: later than the wave 1 a new game opens on. */
const POSED_WAVE = 5;

/**
 * How far the resumed rock may have moved from where it was posed, in logical
 * units.
 *
 * The one frame that carries the press is worth one simulation tick, and a body
 * at rest at `QUIET_CORNER` gains `pull * TICK_DT` of velocity over it and so
 * travels `pull * TICK_DT^2` — under two thousandths of a unit. Ten times that
 * covers a build that resolves its menu before its tick as easily as one that
 * resolves it after, and is still under a thousandth of the Medium's own `26`
 * unit radius: nothing but a field that was relaid can reach it.
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

it("returns to playing with the score, lives, wave and field exactly as they stood", async () => {
  // A run in progress: a score, two ships, wave 5, and one rock still up.
  startPlaying(h);
  h.debug.setScore(POSED_SCORE);
  h.debug.setLives(POSED_LIVES);
  h.debug.setWave(POSED_WAVE);
  const rockId = poseRock(h, "medium", QUIET_CORNER.x, QUIET_CORNER.y);

  h.debug.setScreen("paused");
  h.debug.setMenuIndex(RESUME);

  await h.advance(QUIET_TICKS);
  const before = h.snapshot();

  await tapAction(h, "confirm");
  const after = h.snapshot();

  await h.advance(PICTURE_TICKS);
  captureStill(h, "resumed");

  assertEqual(
    before.screen,
    "paused",
    `the screen after ${String(QUIET_TICKS)} ticks on the pause menu with no ` +
      "key down — a paused game leaves the menu on a confirmed entry " +
      "(specs/ui.md)",
  );

  const took = `on the tick confirm was pressed with the pause menu on entry ${String(RESUME)}, ${JSON.stringify(PAUSE_ITEMS[RESUME])} — RESUME returns to playing with the field and the run exactly as they stood (specs/ui.md), where RESTART would have opened a new game`;

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
