// Spectra — ship/lockout-expires: firing works once the lockout has elapsed.
//
// THE RULE. `specs/ship.md`: the fire lockout "counts down with game time", and
// firing is allowed once it and the other two gates are clear. The review item
// fixes the reading: with the lockout posed at `FLIP_LOCKOUT` and `FLIP_LOCKOUT`
// seconds of game time run, the fire action adds a bullet.
//
// WHY THIS POINT EXISTS BESIDE `ship/lockout-blocks-fire`. The two are the same
// scenario in opposite directions, and they have to grade apart. A build that
// ignores the lockout entirely fires straight away and fails the other point while
// passing this one; a build whose lockout never runs out — counted against
// wall-clock time it never sees, or simply never cleared — passes the other point
// and fails this one. Neither could be told from a correct build by one check
// alone.
//
// THE LOCKOUT IS POSED, NOT FLIPPED FOR. `setFireLockout` is the surface's
// operation for exactly this. It matters more here than in the other direction:
// posing the figure means the seconds waited out are the CASE's `FLIP_LOCKOUT` and
// not the build's, so a build whose flip starts the wrong lockout loses
// `bands/flip-starts-lockout` and is graded here on whether a standing lockout
// counts down at all.
//
// THE ONE EXTRA FRAME, AND WHY IT IS NOT A WEAKENING. `FLIP_LOCKOUT` is 0.30 s,
// which is thirty-six frames of this suite's 120 Hz clock, and a countdown that
// subtracts a frame's delta thirty-six times can land on a residue of a few parts
// in a quadrillion rather than on zero. One extra frame — a hundred-and-twentieth
// of a second, a thirty-sixth of the figure — is the granularity of the clock the
// check is driving and nothing more. It leaves the check exactly as strong: a build
// whose lockout runs long, never clears, or is measured against the wall clock is
// still holding one at frame 37 and still fails.
//
// THE PRESS IS A ONE-FRAME HOLD. `specs/controls.md` reads `a` as a hold, so the
// key goes down, one frame runs, and it is released — `Harness.tap` releases the
// key before the frame runs, which would leave a hold action at rest for the whole
// of it and fire nothing whatever the lockout said.
//
// NOTHING IS FIRED WHILE THE LOCKOUT RUNS OUT. The fire action is not held during
// those frames, so the cooldown `startPosed` left at zero is still at zero when the
// press comes, and the empty roster means the cap cannot bind: of the three gates
// `specs/ship.md` names, none is standing when the press is delivered. That is what
// makes a bullet the only conformant outcome.
//
// THE WORLD IS EMPTY. `startPosed` clears the four rosters — so the bullet counted
// can only be this press's — and shuts the wave's three gates, so nothing arrives
// during the wait and no contact drops the ship into the `ready` phase.

import { afterEach, beforeEach, it } from "vitest";
import { BINDINGS, FLIP_LOCKOUT } from "../../src/constants";
import {
  assertBetween,
  assertEqual,
  assertGreaterThanOrEqual,
  assertLength,
} from "../assert";
import {
  captureStill,
  createHarness,
  holdFor,
  playerBullets,
  seconds,
  startPosed,
  ticksFor,
  type Harness,
} from "../harness";

/** The key the press is delivered on: the first the build bound to `a`. */
const FIRE_KEY = BINDINGS.a[0];

/** The press: the key down for exactly one frame, as the header derives. */
const PRESS_TICKS = 1;

/**
 * The game time run before the press: the review item's `FLIP_LOCKOUT` seconds,
 * plus the one frame of clock granularity the header derives.
 */
const WAIT_TICKS = ticksFor(FLIP_LOCKOUT) + 1;

/** How exactly the posed lockout must read back before the wait: within a frame. */
const POSE_TOLERANCE = seconds(1);

/**
 * The fewest bullets one press must leave on a field that held nothing.
 *
 * A LOWER bound, not an equality. That one press adds EXACTLY one bullet is
 * `ship/fire-spawns-bullet`'s point; all this point claims is that the press was
 * allowed at all once the lockout had run out, so a build with a spread cannon
 * loses that point rather than this one as well.
 */
const BULLETS_AFTER = 1;

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
  const posed = h.snapshot();
  assertEqual(posed.screen, "inWave", "the wave the key is pressed in is live");
  assertEqual(posed.ship.cooldown, 0, "no fire cooldown stands");
  assertBetween(
    posed.ship.lockout,
    FLIP_LOCKOUT - POSE_TOLERANCE,
    FLIP_LOCKOUT + POSE_TOLERANCE,
    `the seconds of fire lockout posed, FLIP_LOCKOUT ` +
      `(${String(FLIP_LOCKOUT)}) (specs/instrumentation.md)`,
  );

  await h.advance(WAIT_TICKS);
  assertLength(
    playerBullets(h.snapshot()),
    0,
    "the field holds none of the player's bullets, so the cap cannot block the " +
      "press",
  );

  await holdFor(h, FIRE_KEY, PRESS_TICKS);
  // Before the assertion, so a check that fails still leaves the picture of the
  // field the press left behind.
  captureStill(h, "fired");

  assertGreaterThanOrEqual(
    playerBullets(h.snapshot()).length,
    BULLETS_AFTER,
    "the player's bullets one press put on the field after " +
      `${String(seconds(WAIT_TICKS))}s of game time ran a FLIP_LOCKOUT ` +
      `(${String(FLIP_LOCKOUT)}) lockout out (specs/ship.md)`,
  );
});
