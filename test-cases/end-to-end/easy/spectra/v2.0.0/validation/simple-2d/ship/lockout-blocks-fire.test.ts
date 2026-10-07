// Spectra — ship/lockout-blocks-fire: the fire lockout blocks firing.
//
// THE RULE. `specs/ship.md` lists the lockout among the three gates on firing:
// "the fire lockout is at zero. A flip sets it to `FLIP_LOCKOUT` (`0.30`) seconds,
// and it counts down with game time", and firing is allowed "only when all three
// ... hold. Otherwise the fire action adds nothing." The review item fixes the
// reading: with the fire lockout posed at `FLIP_LOCKOUT`, the fire action adds no
// bullet.
//
// THE LOCKOUT IS POSED, NOT FLIPPED FOR. `setFireLockout` is the surface's
// operation for exactly this, and `specs/instrumentation.md` says `setShipBand`
// "starts no fire lockout" precisely so the two can be graded apart: that a flip
// starts a lockout of `FLIP_LOCKOUT` is `bands/flip-starts-lockout`'s point, and
// what a standing lockout does to the cannon is this one's. A build whose flip
// forgot the lockout loses that point and keeps this one.
//
// THE FIRE ACTION IS HELD, NOT TAPPED, AND THE HOLD STAYS INSIDE THE LOCKOUT. A
// single frame's press would be satisfied by a build that refuses the first frame
// and then fires on the second, so the action is held for 0.2 s and the roster is
// checked on every one of those frames. 0.2 s is two thirds of `FLIP_LOCKOUT`, so a
// tenth of a second of lockout is still standing when the hold ends and every frame
// sampled is unambiguously inside it — even for a build that counts the lockout
// down a frame faster than it should.
//
// NOTHING ELSE IS BLOCKING THE SHOT, WHICH IS WHAT MAKES THE EMPTY ROSTER MEAN
// SOMETHING. `startPosed` leaves the fire cooldown at zero and the four rosters
// empty, so the cap cannot bind either: of the three gates `specs/ship.md` names,
// the lockout is the only one standing. `ship/lockout-expires` is the same scenario
// with the lockout run out, and it is what stops a build that simply never fires
// from collecting this point.
//
// THE WORLD IS EMPTY. `startPosed` also shuts the wave's three gates, so no drone
// arrives and no contact drops the ship into the `ready` phase — where it could not
// fire for a different reason entirely.

import { afterEach, beforeEach, it } from "vitest";
import { BINDINGS, FLIP_LOCKOUT } from "../constants";
import { assertBetween, assertEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  playerBullets,
  seconds,
  startPosed,
  ticksFor,
  type Harness,
} from "../harness";

/** The key the fire action is held on: the first the build bound to `a`. */
const FIRE_KEY = BINDINGS.a[0];

/**
 * How long fire is held, in seconds of game time and in frames.
 *
 * Two thirds of `FLIP_LOCKOUT`, so the lockout is still standing on every frame
 * sampled and the check never strays into `ship/lockout-expires`'s scenario.
 */
const HOLD_SECONDS = 0.2;
const HOLD_TICKS = ticksFor(HOLD_SECONDS);

/**
 * How exactly the posed lockout must read back before the hold: within one frame
 * of this suite's 120 Hz clock.
 *
 * This is a precondition rather than a measurement — `setFireLockout` is asked for
 * `FLIP_LOCKOUT` and the snapshot is read straight after it, with no frame run in
 * between — and one frame's worth of game time is the room a build that folds a
 * pose into its next update needs.
 */
const POSE_TOLERANCE = seconds(1);

/** What the field must hold at every sample: none of the player's bullets. */
const NO_BULLETS = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("adds no bullet while the fire lockout stands", async () => {
  startPosed(h);
  h.debug.setFireLockout(FLIP_LOCKOUT);
  const before = h.snapshot();
  assertEqual(before.screen, "inWave", "the wave the key is held in is live");
  assertEqual(
    before.ship.cooldown,
    0,
    "no fire cooldown stands to block a shot",
  );
  assertLength(
    playerBullets(before),
    NO_BULLETS,
    "the field holds none of the player's bullets, so the cap cannot bind either",
  );
  assertBetween(
    before.ship.lockout,
    FLIP_LOCKOUT - POSE_TOLERANCE,
    FLIP_LOCKOUT + POSE_TOLERANCE,
    `the seconds of fire lockout posed, FLIP_LOCKOUT ` +
      `(${String(FLIP_LOCKOUT)}) (specs/instrumentation.md)`,
  );

  let seen = 0;
  h.hold(FIRE_KEY);
  try {
    for (let tick = 0; tick < HOLD_TICKS; tick += 1) {
      await h.advance(1);
      seen = Math.max(seen, playerBullets(h.snapshot()).length);
    }
    // Before the assertion, so a check that fails still leaves the picture of the
    // field the locked-out fire left.
    captureStill(h, "blocked");
  } finally {
    h.release(FIRE_KEY);
  }

  assertEqual(
    seen,
    NO_BULLETS,
    "the player's bullets the fire action put on the field over " +
      `${String(HOLD_SECONDS)}s inside a FLIP_LOCKOUT ` +
      `(${String(FLIP_LOCKOUT)}) lockout (specs/ship.md)`,
  );
});
