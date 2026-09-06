// waves/the-ship-flies-during-the-banner — the banner is a breather, not a pause.
//
// `specs/progression.md`, The banner: "The banner is a breather rather than a
// pause. Only the rocks are held back: the ship keeps flying under the player's
// control, timers keep running, and a saucer already on the field keeps
// travelling, keeps firing, and can still be shot down."
//
// THE MISTAKE THIS NAMES. `specs/ui.md` gives the game a screen that really does
// stop everything — `paused` — and a build that reaches for the same switch when
// the banner goes up freezes the player for a second and a half, three times a
// minute, with no way to answer. It is an easy thing to write and it passes every
// other item in this group.
//
// THE READING IS THE BUILD AGAINST ITSELF, and that is deliberate. The requirement
// is not that the ship reaches some particular speed under a banner — what thrust
// does is `specs/ship.md`'s and the `flight` group's — it is that the banner makes
// NO DIFFERENCE to it. So the same ship is flown twice from the same pose with the
// same key held for the same span, once with a banner running and once without, and
// the two speeds are compared. A build that flies identically either way passes
// whatever its thrust curve is; a build that freezes reads a speed under the banner
// far below the one it reaches without it. Nothing about the specification's own
// figures enters the comparison, so nothing about them can decide it.
//
// THE BANNER IS POSED RATHER THAN EARNED, which is the one place in this group that
// is true. `setWaveBanner` is exactly the precondition for a scenario about what
// happens WHILE a banner runs, and posing it keeps the field empty of the wave that
// a real clear would put up — so what the two runs differ by is the banner and
// nothing else. `specs/instrumentation.md` also has a banner already running run
// down with the wave loop shut, so the span really is a banner running.
//
// AND THE SPAN STOPS SHORT OF THE BANNER'S END, at 1.4 of its 1.5 seconds, so every
// tick that is measured is a tick the banner was showing on. The banner is asserted
// to be still running at the end of it, so a build that ignores `setWaveBanner`
// cannot pass by comparing two runs with no banner in either.
//
// THE SHIP IS FLOWN WHERE NOTHING ELSE CAN TOUCH IT. `specs/ship.md` puts the ship
// outside the well entirely — "the star never pulls the ship" — so the only thing
// that can change its velocity is the thrust the check holds; and the lane is the
// bottom of the field, three hundred and thirty units below the star's row, so the
// slide along the core never comes into it.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertGreaterThan } from "../assert";
import { KEYS_THRUST, SHIP_THRUST, WAVE_BANNER_TIME } from "../constants";
import {
  captureStill,
  createHarness,
  startPlaying,
  ticksFor,
  type Harness,
  type ShatterSnapshot,
} from "../harness";

/** The lane the ship is flown along, and where it starts on it. */
const LANE_Y = 690;
const START_X = 200;
/** The facing: along the lane, away from the star's row. */
const FACING = 0;

/** The thrust key, the first of the two `specs/controls.md` binds. */
const THRUST_KEY = KEYS_THRUST[0];

/**
 * How long the key is held: `1.4` seconds, a tenth short of the banner.
 *
 * Every tick of it is a tick the banner was showing on, and the tenth of a second
 * left over is what keeps the reading off the boundary where a build's countdown
 * rounding would decide it.
 */
const THRUST_SECONDS = WAVE_BANNER_TIME - 0.1;
const THRUST_TICKS = ticksFor(THRUST_SECONDS);

/**
 * How far the two speeds may differ: one percent, and half a unit either way.
 *
 * The two runs here hold the same thrust over the same span on the same empty
 * field, and no draw is involved: `specs/simulation.md` fixes the timestep and
 * the order of work inside a tick, so the speed each run integrates is the one
 * `specs/ship.md` states and the allowance covers only a float that made a round
 * trip through JSON. A build that freezes the ship under the banner misses by a
 * hundred percent.
 */
const MATCH_TOLERANCE = 0.01;
const MATCH_FLOOR = 0.5;

/**
 * The least the baseline run must reach for the comparison to mean anything.
 *
 * A quarter of the speed `SHIP_THRUST` alone would build over the span, which is
 * far below anything a working thruster fails to reach and far above the zero two
 * frozen runs would agree on. It is a guard against a vacuous comparison, not a
 * reading of the thrust: what the ship's acceleration actually is belongs to
 * `specs/ship.md` and the `flight` group.
 */
const VACUITY_FLOOR = (SHIP_THRUST * THRUST_SECONDS) / 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

/** Pose the lane, hold thrust for the span, and hand back where the ship ended. */
async function flyTheLane(bannerSeconds: number): Promise<ShatterSnapshot> {
  await startPlaying(h);
  await h.debug.setShipPosition(START_X, LANE_Y);
  await h.debug.setShipVelocity(0, 0);
  await h.debug.setShipAngle(FACING);
  await h.debug.setWaveBanner(bannerSeconds);
  await h.holdFor(THRUST_KEY, THRUST_TICKS);
  return h.snapshot();
}

it("gains the same speed under a banner as it does in open play", async () => {
  const underBanner = await flyTheLane(WAVE_BANNER_TIME);
  // The ship flying on under the banner, which is what the item is about.
  await captureStill(h, "banner");

  assertGreaterThan(
    underBanner.waveBanner,
    0,
    `the seconds left on the banner after ${THRUST_SECONDS} of its ` +
      `${WAVE_BANNER_TIME} seconds: the span this item measures has to be a span ` +
      `the banner was running for, and specs/instrumentation.md has ` +
      `setWaveBanner pose it`,
  );

  const inPlay = await flyTheLane(0);

  assertGreaterThan(
    inPlay.ship.speed,
    VACUITY_FLOOR,
    `the speed the ship reaches over ${THRUST_SECONDS} seconds of held thrust ` +
      `with no banner running, which specs/ship.md accelerates at SHIP_THRUST ` +
      `(${SHIP_THRUST}); the comparison this item makes is worth nothing between ` +
      `two ships that never moved`,
  );

  const allowed = Math.max(inPlay.ship.speed * MATCH_TOLERANCE, MATCH_FLOOR);
  assertBetween(
    underBanner.ship.speed,
    inPlay.ship.speed - allowed,
    inPlay.ship.speed + allowed,
    `the speed the ship reaches over ${THRUST_SECONDS} seconds of held thrust ` +
      `WHILE THE BANNER RUNS, against the ${inPlay.ship.speed} it reaches from ` +
      `the same pose with the same key held and no banner: ` +
      `specs/progression.md makes the banner a breather rather than a pause, so ` +
      `"the ship keeps flying under the player's control"`,
  );
});
