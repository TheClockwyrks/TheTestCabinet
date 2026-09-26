// Spectra — ship/fire-cadence: held fire is spaced by FIRE_INTERVAL.
//
// THE RULE. `specs/ship.md`: "A shot sets [the fire cooldown] to `FIRE_INTERVAL`
// (`0.16`) seconds, and it counts down with game time", and "holding the fire
// action repeats it at the cadence: a shot leaves every `FIRE_INTERVAL` for as
// long as the action is held and the cap and the lockout allow one". The review
// item fixes the reading: fire held for two seconds spaces successive shots
// `FIRE_INTERVAL` apart, within 10%.
//
// THE CAP IS HELD OUT OF THE WAY, AND IT HAS TO BE. `specs/ship.md` also caps the
// player's bullets in flight at `MAX_PLAYER_BULLETS` (3), and a conformant shot
// leaving the nose crosses the play field in about seven tenths of a second — so
// a cadence of 0.16 s puts a fourth shot in the air before the first has left,
// and from roughly half a second in it is the CAP and not the cadence that
// decides when the next shot leaves. A check that simply held fire for two
// seconds and measured the gaps would therefore be grading `ship/fire-cap` under
// this point's name, and would fail a build whose cadence is exactly right. So
// each shot is taken off the field the frame after it appears, with
// `clearPlayerBullets` — the surface's own operation, which removes the player's
// bullets and nothing else — leaving the cooldown as the only gate that can space
// the shots. Nothing about the cooldown is posed: what is measured is the build's
// own.
//
// HOW A SHOT IS DETECTED. By the roster being non-empty at the end of a frame,
// since it was emptied at the end of the one before. Identity is deliberately not
// used: `specs/instrumentation.md` promises only that an id is unique among the
// entities alive at a moment, so a build that reuses a dead bullet's id is
// conformant and would defeat a count of distinct ids. Every frame is sampled, and
// `FIRE_INTERVAL` is sixteen frames of this harness's 100 Hz clock, so no two
// shots can hide inside one sample.
//
// WHAT IS ASSERTED. Every gap between the boundaries of the hold — its start, each
// shot, and its end. The gaps between two SHOTS are the cadence itself and are held
// to the item's 10% on both sides. The opening gap (the hold's start to the first
// shot) and the closing one (the last shot to the hold's end) are bounded from
// above only, because neither end is a shot: together they are what makes the
// two-second reading mean what it says, since without them a build that fired
// three perfectly-spaced shots and then went quiet for a second and a half would
// pass on its three gaps alone.
//
// THE WORLD IS EMPTY, AND NOTHING ELSE GATES THE CANNON. `startPosed` clears the
// four rosters, shuts the wave's three gates, and leaves the fire cooldown and the
// fire lockout at zero, so the first shot leaves on the first frame of the hold and
// no drone, dive or contact interrupts the two seconds.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThanOrEqual,
  assertLessThanOrEqual,
} from "../assert";
import { BINDINGS, FIRE_INTERVAL, MAX_PLAYER_BULLETS } from "../constants";
import {
  captureReplay,
  createHarness,
  framesFor,
  playerBullets,
  seconds,
  startPosed,
  type Harness,
} from "../harness";

/** The key the fire action is held on: the first `specs/controls.md` binds to `a`. */
const FIRE_KEY = BINDINGS.a[0];

/** The two seconds the review item names, in frames of this harness's 100 Hz clock. */
const HOLD_SECONDS = 2;
const HOLD_FRAMES = framesFor(HOLD_SECONDS);

/**
 * The review item's tolerance on the spacing: within 10%.
 *
 * 0.016 s, which is 1.6 frames of this clock, so a build whose cooldown lands a
 * frame either side of the figure passes and one that is two frames out does not.
 * It is far too narrow to admit a cadence of `FLIP_LOCKOUT` (0.30), of half
 * `FIRE_INTERVAL`, or of one shot a frame.
 */
const CADENCE_TOLERANCE = 0.1;
const GAP_MIN = FIRE_INTERVAL * (1 - CADENCE_TOLERANCE);
const GAP_MAX = FIRE_INTERVAL * (1 + CADENCE_TOLERANCE);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("spaces the shots of a two-second hold FIRE_INTERVAL apart", async () => {
  await startPosed(h);
  const before = await h.snapshot();
  assertEqual(before.screen, "inWave", "the wave the key is held in is live");
  assertEqual(before.ship.cooldown, 0, "no fire cooldown stands");
  assertEqual(before.ship.lockout, 0, "and no fire lockout stands");

  /** The seconds into the hold at which a shot was seen, in order. */
  const shots: number[] = [];

  await captureReplay(h, "cadence", async () => {
    await h.hold(FIRE_KEY);
    try {
      for (let frame = 1; frame <= HOLD_FRAMES; frame += 1) {
        await h.advance(1);
        if (playerBullets(await h.snapshot()).length > 0) {
          shots.push(seconds(frame));
          await h.debug.clearPlayerBullets();
        }
      }
    } finally {
      await h.release(FIRE_KEY);
    }
  });

  // The hold's start, every shot, and the hold's end: the gaps between them are
  // the whole of what "spaced FIRE_INTERVAL apart for two seconds" means.
  const boundaries = [0, ...shots, HOLD_SECONDS];
  for (let i = 0; i + 1 < boundaries.length; i += 1) {
    const gap = boundaries[i + 1] - boundaries[i];
    const opens = i === 0 ? "the hold began" : `shot ${i}`;
    const closes =
      i + 2 === boundaries.length ? "the hold ended" : `shot ${i + 1}`;
    const context = `the seconds from ${opens} to ${closes} of a ${HOLD_SECONDS}s hold, FIRE_INTERVAL (${FIRE_INTERVAL}) apart, with the MAX_PLAYER_BULLETS (${MAX_PLAYER_BULLETS}) cap held clear (specs/ship.md)`;

    assertLessThanOrEqual(gap, GAP_MAX, context);
    // Only a gap with a shot at BOTH ends is a cadence; the hold's own start and
    // end are boundaries rather than shots, so they are bounded from above alone.
    if (i > 0 && i + 2 < boundaries.length) {
      assertGreaterThanOrEqual(gap, GAP_MIN, context);
    }
  }
});
