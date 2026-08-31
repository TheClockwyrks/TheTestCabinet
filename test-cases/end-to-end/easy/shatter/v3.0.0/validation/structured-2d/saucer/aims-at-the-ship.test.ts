// saucer/aims-at-the-ship — the saucer's rounds go where the ship is.
//
// THE RULE. `specs/saucer.md`, Firing: the saucer "fires one saucer bullet aimed
// at the ship's current position", and "the shot's bearing is the bearing from the
// saucer to the ship, offset by an angle drawn afresh for every shot, uniformly
// from `-SAUCER_AIM_ERROR` to `+SAUCER_AIM_ERROR` (`10` degrees)". A single shot
// therefore says almost nothing — it is entitled to be ten degrees off — so the
// AIM is read as the mean of sixty of them, which the error cannot move.
//
// THE THREE DEGREES ARE DERIVED FROM THE SPECIFICATION AND THE SAMPLE SIZE, NEVER
// FROM A REFERENCE RUN. The per-shot error is a uniform draw over
// `+/- SAUCER_AIM_ERROR`, whose standard deviation is `E / sqrt(3)` = `5.77`
// degrees. The mean of `n` such draws therefore has a standard error of
// `E / sqrt(3n)`, which at `n = 60` is `0.745` degrees — so three degrees is four
// standard errors, which a conformant build clears in all but about one run in
// sixteen thousand, and which a build that aims at where the ship WAS, or at the
// field's centre, or leads a stationary target, misses outright.
//
// WHAT IS READ. The bearing each round's velocity runs along at the sample it
// first appears on, against the bearing from the saucer to the ship — measured
// along the shortest wrapped separation, which is what every rule that aims at a
// body in this game means (`specs/field.md`) — and the mean of the sixty signed
// differences.
//
// THE SAUCER IS POSED AT REST, AND THAT IS LOAD-BEARING. A round leaves at
// `SAUCER_BULLET_SPEED` "plus the saucer's own velocity", and `addSaucer` brings a
// craft on at `SAUCER_SPEED` (`140`) — which would tilt every bearing here by
// seventeen degrees and grade the inheritance instead of the aim. The inheritance
// is `saucer/bullet-carries-the-saucers-velocity`'s point;
// `setSaucerVelocity(0, 0)` is what keeps it out of this one. The mind and the
// travel are shut too, so the craft stands where it was put and the bearing to the
// ship is one number for the whole run. See `shots.ts`.
//
// THE SHIP IS POSED 400 UNITS AWAY AND LEFT THERE, at rest with its lethal contact
// test shut (`startPlaying`), so the rounds pass over it rather than ending the
// run — and so "the ship's current position" is a fixed thing the sixty shots can
// be averaged against.
//
// WHERE THE SCENARIO STANDS, AND WHY IT IS IN A CORNER. A round is ballistic from
// the moment it leaves (`specs/saucer.md`: "It is pulled by the well"), and this
// point samples every `SHOT_TICKS_PER_FRAME` ticks, so a reading can be up to
// three ticks old. At `(60, 60)` the well pulls at `10.6` units per second squared
// (`specs/gravity.md`), which over three ticks turns a `300`-unit-per-second round
// by `0.05` degrees — a fifteenth of one standard error, and a sixtieth of the
// bound. The lane to the ship passes `300` units clear of the star, so no round is
// absorbed on its way there either.

import { afterEach, beforeEach, it } from "vitest";
import { DEG, SAUCER_AIM_ERROR } from "../../src/constants";
import { assertLength, assertLessThanOrEqual } from "../assert";
import { angleDelta } from "../geometry";
import {
  captureStill,
  poseShip,
  resetTo,
  startPlaying,
  type Harness,
} from "../harness";
import {
  collectShots,
  createShotHarness,
  framesFor,
  poseGunner,
  SHOT_TICKS_PER_FRAME,
} from "./shots";

/** The seed the run is opened on, so the sixty draws are the same every run. */
const SEED = 1;

/** Where the gunner stands, at rest. See the header for why this corner. */
const GUN_POSE = { x: 60, y: 60, vx: 0, vy: 0 };

/** Where the ship is posed: 400 units away, along the row the gunner is on. */
const SHIP_X = 460;
const SHIP_Y = 60;

/** How many shots the mean is taken over. */
const SHOTS = 60;

/**
 * How long the collection may run for, in seconds of game time.
 *
 * Sixty shots at `SAUCER_FIRE_INTERVAL` is `96` s of firing, and a visit lasting
 * `SAUCER_LIFETIME` (`12` s) yields seven shots before the gunner has to be posed
 * again — so nine visits, about `110` s. `140` is the budget a run that never
 * reaches sixty is cut off at, so it is reported as a shot count rather than as a
 * bearing.
 */
const BUDGET = 140;

/**
 * How far the mean bearing may sit from the bearing to the ship, in radians.
 *
 * Three degrees: four standard errors of the mean of `SHOTS` uniform draws over
 * `+/- SAUCER_AIM_ERROR`. See the header for the derivation.
 */
const TOLERANCE = 3 * DEG;

let h: Harness;

beforeEach(async () => {
  h = await createShotHarness();
});

afterEach(() => {
  h?.dispose();
});

it("centres sixty shots on the bearing to the ship within three degrees", async () => {
  resetTo(h, SEED);
  startPlaying(h);
  poseShip(h, { x: SHIP_X, y: SHIP_Y, vx: 0, vy: 0 });
  poseGunner(h, GUN_POSE);

  const shots = await collectShots(
    h,
    GUN_POSE,
    SHOTS,
    framesFor(BUDGET, SHOT_TICKS_PER_FRAME),
  );
  // The spread of sixty aimed shots at the ship.
  captureStill(h, "aim");

  assertLength(
    shots,
    SHOTS,
    `rounds collected inside ${BUDGET} s of game time — the saucer fires one ` +
      "every SAUCER_FIRE_INTERVAL it is on the field (specs/saucer.md)",
  );

  const errors = shots.map((shot) => angleDelta(shot.aimed, shot.heading));
  const mean = errors.reduce((sum, error) => sum + error, 0) / errors.length;

  assertLessThanOrEqual(
    Math.abs(mean / DEG),
    TOLERANCE / DEG,
    `the mean bearing of ${SHOTS} shots, in degrees off the bearing from the ` +
      "saucer to the ship — the per-shot error is a uniform draw over " +
      `+/- SAUCER_AIM_ERROR (${SAUCER_AIM_ERROR / DEG} degrees), so the mean ` +
      `of ${SHOTS} has a standard error of ` +
      `${(SAUCER_AIM_ERROR / DEG / Math.sqrt(3 * SHOTS)).toFixed(3)} degrees ` +
      "and this bound is four of them (specs/saucer.md)",
  );
});
