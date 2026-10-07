// saucer — the handful of shots the aim checks read. LOCAL TO THIS GROUP.
//
// `specs/saucer.md` gives the saucer's aim three separable properties — it
// points at the ship, its per-shot error stays inside a bound, and that error is
// redrawn for every shot — and each is an item of its own, because a build that
// aims dead-on and a build that scatters over thirty degrees are different
// faults and must grade differently. What all three share is the SCENARIO: a
// saucer standing still, a ship standing still four hundred units away, and
// a handful of shots read as they leave. So the scenario is built once, here, and each
// check reads its own thing off it.
//
// IT LIVES IN THE GROUP because nothing outside `saucer` reads a saucer's aim.
//
// NOT ONE FIGURE BELOW IS A BOUND. The placement, the sample size and the length
// of a visit are geometry and cost; every tolerance stays in the check that
// asserts it, derived there from the figure `specs/saucer.md` fixes for it.

import { SAUCER_AIM_ERROR, SAUCER_FIRE_INTERVAL } from "../constants";
import { fail } from "../assert";
import {
  angleBetween,
  degrees,
  headingOf,
  separation,
  type Point,
} from "../geometry";
import { startPlaying, ticksFor, type Harness } from "../harness";
import { nextVolley } from "./cadence";
import { poseVisit } from "./visit";

/**
 * `SAUCER_AIM_ERROR` in the degrees `specs/saucer.md` states it in: `10`.
 *
 * `../constants` carries it in radians, because every angle the surface
 * takes or reports is in radians; the specification's own figure is the degree,
 * and all three aim items assert against the degree.
 */
export const SAUCER_AIM_ERROR_DEG = degrees(SAUCER_AIM_ERROR);

/**
 * Where the saucer stands: `(140, 640)`, `573` units from the star.
 *
 * FAR OUT ON PURPOSE. A shot's bearing is read off the velocity the round is
 * first reported with, and the well is the one thing that could have moved it
 * between the gun and the reading. At this distance `specs/gravity.md`'s pull is
 * about `13` units per second squared, so a tick of it turns a
 * `300`-unit-per-second round by `0.02` degrees — a fiftieth of the tightest
 * bound any of the three checks asserts. The reading is the gun's, not the
 * well's.
 */
export const SAUCER_STAND: Point = { x: 140, y: 640 };

/**
 * Where the ship stands: `400` units due right of the saucer, the item's figure.
 *
 * On the same row, so the bearing to it is a straight `0` and a reader can see
 * at a glance what an error of a few degrees means. `startPlaying` leaves the
 * ship at rest with its contact test off, and the well never pulls it
 * (`specs/gravity.md`), so it stands exactly where it is put for the whole span.
 */
export const SHIP_STAND: Point = { x: SAUCER_STAND.x + 400, y: SAUCER_STAND.y };

/**
 * The eight shots the two unposed aim checks read.
 *
 * A HANDFUL, NOT A SAMPLE. `aim-error-within-10-degrees` holds each of them
 * inside the bound `specs/saucer.md` states and `aim-error-varies-per-shot` asks
 * only that they are not all one bearing; neither reads a statistic off them,
 * because how a build's draw is shaped inside the stated range is the reviewer's
 * to judge. Eight is two visits' worth at `SHOTS_PER_VISIT`, so the scenario is
 * re-posed once and a build that fires only on a fresh visit is read across the
 * renewal. `aims-at-the-ship` poses its error and reads one shot of its own.
 */
export const SHOT_COUNT = 8;

/**
 * How many shots are taken from each saucer before another is brought on.
 *
 * A CONSEQUENCE OF THE SPECIFICATION, NOT A CHOICE. `specs/saucer.md` gives a
 * visit `SAUCER_LIFETIME` (`12` seconds), and eight shots at
 * `SAUCER_FIRE_INTERVAL` is `12.8` — so no single visit can produce them and
 * the scenario is re-posed as the first visit runs out. Six shots is `9.6` seconds,
 * comfortably inside a visit, and `addSaucer` "replaces any saucer already up"
 * with its clocks at their opening values, so each batch is the same scenario
 * over again. Every shot read is a real shot from a saucer standing at the same
 * place aiming at a ship standing at the same place.
 */
export const SHOTS_PER_VISIT = 6;

/** How long each shot is waited for before a silent gun is called on it. */
const SHOT_CEILING = ticksFor(4 * SAUCER_FIRE_INTERVAL);

/** Bring the saucer on at its stand, standing still, with only its gun running. */
function standSaucer(h: Harness): void {
  poseVisit(h, SAUCER_STAND.x, SAUCER_STAND.y, {
    vx: 0,
    vy: 0,
    mind: false,
    travel: false,
  });
}

/**
 * Pose the scenario and read the aim error of `SHOT_COUNT` shots, in degrees.
 *
 * The error is signed, taken as the turn from the bearing to the SHIP to the
 * bearing the round left along, so a build that aims dead-on reads nothing but
 * zeros and a build with a fixed lead reads copies of one number. The saucer's own
 * velocity is subtracted first, because `specs/saucer.md` has the round leave
 * "at `SAUCER_BULLET_SPEED` along that bearing, PLUS the saucer's own velocity"
 * — here the saucer is posed at rest, so the subtraction takes nothing away and
 * says which of the two quantities is being read.
 * `bullet-carries-the-saucers-velocity` is the item that poses a moving one.
 *
 * A round with no velocity at all has no bearing to read, and a build that
 * produced one fails here by assertion naming the muzzle speed it owes rather
 * than reading as an aim of zero degrees.
 */
export async function readAimErrors(h: Harness): Promise<number[]> {
  startPlaying(h);
  h.debug.setShipPosition(SHIP_STAND.x, SHIP_STAND.y);
  standSaucer(h);

  const toShip = separation(SAUCER_STAND, SHIP_STAND);
  const wanted = Math.atan2(toShip.y, toShip.x);
  const errors: number[] = [];

  // UNDRAWN, BECAUSE THE READING IS A LIST OF VELOCITIES. Thirteen seconds of
  // game time reach the eight shots, sampled a tick at a time so that no shot is
  // stepped over, and every one of those ticks would otherwise be drawn for a
  // picture nothing reads. The ticks, the snapshots and the shots caught are the
  // same either way; only the renders are gone.
  await h.quiet(async () => {
    for (let shot = 0; shot < SHOT_COUNT; shot += 1) {
      if (shot > 0 && shot % SHOTS_PER_VISIT === 0) standSaucer(h);
      const volley = await nextVolley(h, { maxTicks: SHOT_CEILING });
      const carried = volley.saucer ?? { vx: 0, vy: 0 };
      const round = volley.fired[0];
      const aim = headingOf({
        vx: round.vx - carried.vx,
        vy: round.vy - carried.vy,
      });
      if (aim === null) {
        fail(
          "a round leaving at SAUCER_BULLET_SPEED along a bearing " +
            "(specs/saucer.md)",
          "a saucer bullet with no velocity of its own",
        );
      }
      errors.push(degrees(angleBetween(wanted, aim)));
    }
  });
  // One drawn tick, after every reading is taken, so the still the three items
  // capture is the field they read rather than an older frame.
  await h.advance(1);
  return errors;
}
