// ship/fire-cadence — held fire spaces its shots `FIRE_INTERVAL` apart.
//
// specs/ship.md, "What blocks a shot": "The fire cooldown is at zero. A shot sets it
// to `FIRE_INTERVAL` (`0.16`) seconds, and it counts down with game time", and
// "Holding the fire action repeats it at the cadence: a shot leaves every
// `FIRE_INTERVAL` for as long as the action is held and the cap and the lockout
// allow one." This point decides the SPACING. That a held key repeats at all is
// `controls/fire-autorepeats`, and the cap is `ship/fire-cap`.
//
// THE CAP IS TAKEN OUT OF THE MEASUREMENT, ON PURPOSE. `specs/ship.md` gates a shot
// on the cadence AND the cap together, and with a bullet's life what it is — the
// nose is 514 units under `FIELD_TOP` and `PLAYER_BULLET_SPEED` covers that in 0.68
// s, more than four cadence periods — a conforming build hits
// `MAX_PLAYER_BULLETS` (`3`) after its third shot and its fourth is spaced by the
// CAP rather than by the cadence. A check that measured the raw spacing over two
// seconds would therefore fail a perfectly conformant build for obeying the other
// half of its own specification. So each shot is taken off the field on the frame it
// is counted, with `clearPlayerBullets` — a declared pose
// (specs/instrumentation.md) — which leaves the cap permanently open and the
// cooldown as the only thing that can space a shot. The lockout is at zero
// throughout: nothing here flips.
//
// HOW A SHOT IS COUNTED. Every frame-to-frame RISE in the number of the player's
// bullets, sampled once per frame. Identity is deliberately not used:
// specs/instrumentation.md promises only that an id is unique among the entities
// alive at a moment, so a build that reissues a dead bullet's id is conformant and
// would defeat a count of distinct ids. `FIRE_INTERVAL` is sixteen frames of the
// harness's 100 Hz clock, so no two shots can hide inside one sample.
//
// THE TOLERANCE IS THE REVIEW ITEM'S: within 10% of `FIRE_INTERVAL`, which is 0.016
// s. The clock quantises a spacing to whole frames of 0.01 s, so 15, 16 and 17
// frames all sit inside the band and 14 or 18 do not — which is the point: a build
// that fired every frame, every other frame, or twice as slowly reads as a plainly
// different number.
//
// EVERY SPACING IS GRADED, not their mean, so a build that fires a burst and then
// waits fails on the gap it got wrong rather than averaging its way through.
//
// THE COUNT ITSELF IS NOT GRADED. Two shots is all the scenario needs for there to
// be a spacing at all, and the floor is stated as exactly that: a build whose repeat
// is broken loses `controls/fire-autorepeats`, and should not be charged for it
// twice here.
//
// THE WORLD IS EMPTY AND QUIET. `startPosed` clears the four rosters and shuts the
// wave's entry gate, its dive gate and the ship's contact test, so every bullet
// counted over the two seconds is one this key fired.

import { afterEach, beforeEach, it } from "vitest";
import { FIRE_INTERVAL } from "../constants";
import {
  assertBetween,
  assertEqual,
  assertGreaterThanOrEqual,
} from "../assert";
import {
  captureReplay,
  createHarness,
  playerBullets,
  seconds,
  startPosed,
  ticksFor,
  type Harness,
} from "../harness";
import { FIRE_KEY } from "./cannon";

/** The review item's tolerance on the spacing: within 10% of `FIRE_INTERVAL`. */
const CADENCE_TOLERANCE = 0.1;

/** How long the fire action is held: the two seconds the review item names. */
const HOLD_SECONDS = 2;
const HOLD_FRAMES = ticksFor(HOLD_SECONDS);

/**
 * How many shots the window must hold for there to be a spacing to read.
 *
 * The scenario's own precondition and nothing more. What `specs/ship.md` states
 * would give a conformant build twelve or thirteen over two seconds, and demanding
 * that count would grade the repeat a second time — `controls/fire-autorepeats`
 * owns it.
 */
const MIN_SHOTS = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("spaces successive shots FIRE_INTERVAL apart while fire is held", async () => {
  startPosed(h);

  const before = h.snapshot();
  assertEqual(before.screen, "inWave", "the screen that reads the fire action");
  assertEqual(
    before.ship.cooldown,
    0,
    "the fire cooldown the ship was posed with",
  );
  assertEqual(
    before.ship.lockout,
    0,
    "the fire lockout the ship was posed with",
  );

  const shotFrames = await captureReplay(h, "cadence", async () => {
    const frames: number[] = [];
    h.hold(FIRE_KEY);
    try {
      let inFlight = 0;
      for (let frame = 0; frame < HOLD_FRAMES; frame += 1) {
        await h.advance(1);
        const now = playerBullets(h.snapshot()).length;
        if (now > inFlight) {
          frames.push(frame);
          // The counted shot leaves the field, so the cap can never close and the
          // cooldown is the only thing left that can space the next one.
          h.debug.clearPlayerBullets();
          inFlight = 0;
        } else {
          inFlight = now;
        }
      }
    } finally {
      h.release(FIRE_KEY);
    }
    return frames;
  });

  assertGreaterThanOrEqual(
    shotFrames.length,
    MIN_SHOTS,
    `shots taken over ${String(HOLD_SECONDS)}s of held fire, so there is a ` +
      "spacing to read at all",
  );

  for (let shot = 1; shot < shotFrames.length; shot += 1) {
    assertBetween(
      seconds(shotFrames[shot] - shotFrames[shot - 1]),
      FIRE_INTERVAL * (1 - CADENCE_TOLERANCE),
      FIRE_INTERVAL * (1 + CADENCE_TOLERANCE),
      `the seconds between shot ${String(shot)} and shot ` +
        `${String(shot + 1)} of ${String(shotFrames.length)}, with the cap held ` +
        `open — FIRE_INTERVAL (${String(FIRE_INTERVAL)}) within ` +
        `${String(CADENCE_TOLERANCE * 100)}% (specs/ship.md)`,
    );
  }
});
