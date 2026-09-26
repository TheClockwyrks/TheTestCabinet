// foes/spawn-clock-holds-in-banner — a spawner clock stands through the banner
// and counts down only once the level's play is active.
//
// `specs/foes.md`, The spawner clocks: a clock above `0` "counts down against
// each update's delta while the level's play is active and its foe spawning is
// running", and "A clock holds its value whenever it is not counting down:
// through the level's banner, through a respawn, on every other screen, and
// while foe spawning is off", so "the banner or the respawn giving way to active
// play leaves them standing too".
//
// THE CLOCK IS POSED DURING THE BANNER AND READ AFTER THE BANNER HAS GIVEN WAY.
// With half a second of banner left, the glitch's clock is posed at 1.5 s, and
// 0.6 s of play later the phase is active and the clock has counted down only
// through the 0.1 s of active play it saw: it reads at most 1.5 s and at least
// 1.5 s less those 0.1 s less two updates, the update the banner gave way on
// and the one the reading may sit inside. A build that counts the clock down
// through the banner reads 0.9 s and fails; a build that zeroes or redraws its
// clocks as play becomes active reads 6.9 s or more, or 0, and fails.
//
// Nothing else is posed: `startPlaying` leaves the board empty and quiet with
// worm entry off, so the banner giving way brings no worm in, and foe spawning
// is turned back on because the clock this point reads runs only while it is.
// At level 2 the glitch's clock is the only one running.

import { afterEach, beforeEach, it } from "vitest";
import { GLITCH_FROM_LEVEL } from "../constants";
import { assertBetween, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startPlaying,
  ticksFor,
  TICK_HZ,
  type Harness,
} from "../harness";

/** The level the clock is posed at: the one glitches begin at. */
const LEVEL = GLITCH_FROM_LEVEL;

/** The seconds posed on the glitch's clock, during the banner. */
const POSED_SECONDS = 1.5;

/** The banner left to run when the clock is posed, in seconds. */
const BANNER_LEFT_SECONDS = 0.5;

/** The active play run after the banner gives way, in seconds. */
const ACTIVE_SECONDS = 0.1;

/** The delta of one update, in seconds. */
const UPDATE_SECONDS = 1 / TICK_HZ;

/**
 * The most the clock may have counted down: the active play it saw, plus the
 * update the banner gave way on and the update the reading may sit inside.
 */
const MOST_COUNTED_SECONDS = ACTIVE_SECONDS + 2 * UPDATE_SECONDS;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("holds a clock posed during the banner until play is active", async () => {
  startPlaying(h);
  h.debug.setLevel(LEVEL);
  h.debug.setFoeSpawning(true);
  h.debug.setPhase("banner");
  h.debug.setPhaseTimer(BANNER_LEFT_SECONDS);
  h.debug.setSpawnTimer("glitch", POSED_SECONDS);

  await h.advance(ticksFor(BANNER_LEFT_SECONDS + ACTIVE_SECONDS));
  const snapshot = h.snapshot();
  // Before the assertions, so a failing clock still leaves the picture of the
  // board it was read on.
  captureStill(h, "held");

  assertEqual(
    snapshot.phase,
    "active",
    `the phase ${BANNER_LEFT_SECONDS + ACTIVE_SECONDS} s after a banner with ` +
      `${BANNER_LEFT_SECONDS} s left — the banner gives way to active play ` +
      `when its timer runs out (specs/progression.md)`,
  );
  assertBetween(
    snapshot.glitchTimer,
    POSED_SECONDS - MOST_COUNTED_SECONDS,
    POSED_SECONDS,
    `snapshot().glitchTimer after a clock posed at ${POSED_SECONDS} s during ` +
      `the banner, ${BANNER_LEFT_SECONDS} s of banner and ${ACTIVE_SECONDS} s ` +
      `of active play later — the clock stands through the banner and counts ` +
      `down only while play is active (specs/foes.md)`,
  );
});
