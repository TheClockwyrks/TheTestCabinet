// ship/lockout-expires — once the fire lockout has counted down, the cannon fires
// again.
//
// specs/ship.md, "What blocks a shot": "The fire lockout is at zero. A flip sets it
// to `FLIP_LOCKOUT` (`0.30`) seconds, and it counts down with game time." The gate
// is on the lockout STANDING, so a lockout that has run out blocks nothing. This
// point decides that the block lifts; `ship/lockout-blocks-fire` decides that it
// blocks while it stands. Graded apart, a build that ignores the lockout and a build
// that never lets it go lose one point each rather than sharing one.
//
// THE LOCKOUT IS POSED, NOT FLIPPED FOR. The review item says so — "With the lockout
// posed at `FLIP_LOCKOUT` and `FLIP_LOCKOUT` seconds of game time run" — and it
// keeps the flip, which is `bands/flip-starts-lockout`'s point, out of a check about
// the cannon.
//
// NOTHING IS HELD WHILE THE LOCKOUT RUNS DOWN. The lockout "counts down with game
// time", so the thirty frames that spend it are thirty ordinary frames with no key
// on the board; the check asserts the field is still empty when they are over, which
// is what makes the shot that follows unambiguously the one the expired lockout
// allowed.
//
// THE HOLD THAT FOLLOWS IS ONE FIRE_INTERVAL AND TWO FRAMES. `startPosed` leaves the
// cadence and the cap clear and the countdown has spent the lockout, so a conforming
// build fires on the first frame it reads the key down; a whole `FIRE_INTERVAL` plus
// the frame the key-down is delivered on is a ceiling on the build's own latency
// rather than a rate, and no spacing is read from it. It is deliberately generous in
// one direction only: a build whose countdown lags the specification by a frame or
// two still fires inside the window and keeps this point, while a build that never
// clears its lockout fires nothing however long the key is down.
//
// WHAT IS ASSERTED IS A FLOOR, not an equality. `FIRE_INTERVAL` is sixteen frames of
// the harness's 100 Hz clock and the key is held for eighteen, so a build firing at
// exactly the cadence `specs/ship.md` states takes a second shot inside the window
// and must not lose this point for obeying its own specification. The cadence is
// `ship/fire-cadence`'s and the cap is `ship/fire-cap`'s.
//
// THE WORLD IS EMPTY AND QUIET. `startPosed` clears the four rosters and shuts the
// wave's entry gate, its dive gate and the ship's contact test, so the bullets
// counted at the end are the ones this key fired.

import { afterEach, beforeEach, it } from "vitest";
import { FIRE_INTERVAL, FLIP_LOCKOUT } from "../constants";
import { assertEqual, assertGreaterThanOrEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  holdFor,
  playerBullets,
  startPosed,
  ticksFor,
  type Harness,
} from "../harness";
import { FIRE_KEY } from "./cannon";

/** The frames the lockout is left to count down: the `FLIP_LOCKOUT` the item names. */
const COUNTDOWN_FRAMES = ticksFor(FLIP_LOCKOUT);

/**
 * The frames the fire action is held once the lockout has run out.
 *
 * One whole `FIRE_INTERVAL` plus the two frames that cover the key-down's own
 * delivery: a ceiling on how late a build may read its input and still count as
 * firing, never a rate.
 */
const HELD_FRAMES = ticksFor(FIRE_INTERVAL) + 2;

/** What the field must hold once the key has been held: at least the one shot. */
const MIN_SHOTS = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("fires once FLIP_LOCKOUT seconds of game time have run", async () => {
  startPosed(h);
  h.debug.setFireLockout(FLIP_LOCKOUT);

  const before = h.snapshot();
  assertEqual(before.screen, "inWave", "the screen that reads the fire action");
  assertEqual(
    before.phase,
    "live",
    "the ship is flying rather than respawning",
  );
  assertEqual(
    before.ship.lockout,
    FLIP_LOCKOUT,
    `the seconds of fire lockout the ship was posed with, FLIP_LOCKOUT ` +
      "(specs/instrumentation.md)",
  );

  await h.advance(COUNTDOWN_FRAMES);
  assertLength(
    playerBullets(h.snapshot()),
    0,
    `the player's bullets on the field after ${String(COUNTDOWN_FRAMES)} ` +
      "frames with no key down, so the shot below is the one the key fired",
  );

  await holdFor(h, FIRE_KEY, HELD_FRAMES);
  // Before the assertion, so a check that fails still leaves the picture of the
  // field the expired lockout allowed.
  captureStill(h, "fired");

  assertGreaterThanOrEqual(
    playerBullets(h.snapshot()).length,
    MIN_SHOTS,
    `the player's bullets on the field after ${String(FLIP_LOCKOUT)}s of game ` +
      `time spent the posed lockout and the fire action was then held for ` +
      `${String(HELD_FRAMES)} frames, with the cadence and the cap clear ` +
      "(specs/ship.md)",
  );
});
