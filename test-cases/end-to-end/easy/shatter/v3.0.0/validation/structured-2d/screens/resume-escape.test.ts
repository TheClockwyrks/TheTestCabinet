// screens/resume-escape — the leave key gives a paused game back, once.
//
// `specs/controls.md` gives `back` the meaning "Leave the screen" on a menu
// screen, and `specs/ui.md` says what leaving the pause menu is: "Leaving this
// screen and pausing again each do what `RESUME` does." `RESUME` "Returns to
// `playing` with the field and the run exactly as they stood."
//
// AND ONCE IS HALF THE REQUIREMENT. `Escape` is bound to `back` AND to `pause`, so
// one press raises both actions on one frame. `specs/controls.md` settles what
// that frame does: "On `paused`, `pause` and `back` are read before the menu
// edges, and a frame carrying either resumes and does nothing else", so "a single
// `Escape` press on `paused` resumes once". A build that answered both actions in
// turn would resume and immediately pause again, reading `playing` for a tick and
// the pause menu after it — which is why the screen is read a second time a
// quarter of a second later.
//
// THE KEY IS PRESSED HERE RATHER THAN THE ACTION, deliberately: what this item is
// about is the one physical `Escape` press raising two actions at once, and
// driving a single action would not pose that at all. Which key `back` is bound to
// stays `controls/back-escape`'s point; this check reads the binding rather than
// naming a key of its own.
//
// THE RUN IS POSED SO THAT RESUMING AND RESTARTING READ AS DIFFERENT NUMBERS, the
// same pose `screens/resume-returns-to-play` uses.
//
// WHAT THIS DOES NOT DECIDE. That `Escape` pauses (`controls/pause-escape`), that
// it leaves a menu screen (`controls/back-escape`), that the pause action resumes
// (`screens/resume-p`), or what the `RESUME` entry does
// (`screens/resume-returns-to-play`).

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertLessThan } from "../assert";
import { BINDINGS } from "../constants";
import { QUIET_CORNER } from "../fixtures";
import { directDistance, driftOver } from "../geometry";
import {
  captureStill,
  createHarness,
  poseRock,
  requireRock,
  seconds,
  startPlaying,
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

/** Ticks held after the resume, long enough that a re-pause would show. */
const SETTLED_TICKS = ticksFor(0.25);

/**
 * The key pressed here: the one `specs/controls.md` binds to `back`, which it also
 * binds to `pause`. Read to drive the build and never compared against — which key
 * raises `back` is `controls/back-escape`'s point.
 */
const BACK_KEY = BINDINGS.back.keys[0] ?? "Escape";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("returns to playing on one Escape press, and leaves it returned", async () => {
  startPlaying(h);
  h.debug.setScore(POSED_SCORE);
  h.debug.setLives(POSED_LIVES);
  h.debug.setWave(POSED_WAVE);
  const rockId = poseRock(h, "medium", QUIET_CORNER.x, QUIET_CORNER.y);
  h.debug.setScreen("paused");

  await h.advance(QUIET_TICKS);
  const before = h.snapshot();

  await h.tap(BACK_KEY);
  const after = h.snapshot();

  assertEqual(
    before.screen,
    "paused",
    `the screen after ${String(QUIET_TICKS)} ticks on the pause menu with no ` +
      "key down — a paused game leaves the menu on a press (specs/ui.md)",
  );

  const took =
    "on the tick the one Escape press landed on the pause menu — leaving this " +
    "screen does what RESUME does (specs/ui.md), where RESTART would have " +
    "opened a new game";

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

  await h.advance(SETTLED_TICKS);
  captureStill(h, "resumed");
  assertEqual(
    h.snapshot().screen,
    "playing",
    `the screen ${String(SETTLED_TICKS)} ticks after the one Escape press — a ` +
      "frame carrying pause or back resumes and does nothing else " +
      "(specs/controls.md)",
  );
});
