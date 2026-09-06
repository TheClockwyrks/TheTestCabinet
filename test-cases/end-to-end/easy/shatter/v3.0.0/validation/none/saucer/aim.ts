// Shatter — the handful of shots the aim checks read. CASE-PROVIDED.
//
// `specs/saucer.md` gives the saucer's aim three separable properties — it points
// at the ship, its error stays inside a bound, and the error is redrawn for every
// shot — and each is an item of its own, because a build that aims dead-on and a
// build that scatters over thirty degrees are different faults and must grade
// differently. What all three share is the SCENARIO: a saucer standing still, a
// ship standing still four hundred units away, and a handful of shots read as
// they leave.
// So the scenario is built once, here, and each check reads its own thing off it.
//
// IT LIVES IN THE GROUP because nothing outside `saucer` reads a saucer's aim.
//
// NOT ONE FIGURE BELOW IS A BOUND. The placement, the sample size, the lead-in and
// the length of a visit are geometry and cost; every tolerance stays in the check
// that asserts it, derived there from the figure `specs/saucer.md` fixes for it.

import { DEG, SAUCER_FIRE_INTERVAL } from "../constants";
import { angleDelta, bearingOf, bearingTo, subtract } from "../geometry";
import {
  poseSaucer,
  startPlaying,
  ticksFor,
  velocityOf,
  type Harness,
} from "../harness";
import { nextVolley } from "./cadence";

/**
 * Where the saucer stands: `(140, 640)`, `573` units from the star.
 *
 * FAR OUT ON PURPOSE. A shot's bearing is read off the velocity the round is first
 * reported with, and the well is the one thing that could have moved it between the
 * gun and the reading. At this distance `specs/gravity.md`'s pull is about `13`
 * units per second squared, so a tick of it turns a `300`-unit-per-second round by
 * `0.02` degrees — a fiftieth of the tightest bound any of the three checks
 * asserts. The reading is the gun's, not the well's.
 */
export const SAUCER_STAND = { x: 140, y: 640 };

/**
 * Where the ship stands: `400` units due right of the saucer, the item's figure.
 *
 * On the same row, so the bearing to it is a straight `0` and a reader can see at a
 * glance what an error of a few degrees means. `startPlaying` leaves the ship at
 * rest with its contact test off, and the well never pulls it
 * (`specs/gravity.md`), so it stands exactly where it is put for the whole span.
 */
export const SHIP_STAND = { x: SAUCER_STAND.x + 400, y: SAUCER_STAND.y };

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
 * A CONSEQUENCE OF THE SPECIFICATION, NOT A CHOICE. `specs/saucer.md` gives a visit
 * `SAUCER_LIFETIME` (`12` seconds), and eight shots at `SAUCER_FIRE_INTERVAL` is
 * `12.8` — so no single visit can produce them and the scenario is re-posed as
 * the first visit runs out. Six shots is `9.6` seconds, comfortably inside a visit, and
 * `addSaucer` "replaces any saucer already up" with its clocks at their opening
 * values, so each batch is the same scenario over again. Every shot read is a real
 * shot from a saucer standing at the same place aiming at a ship standing at the
 * same place.
 */
export const SHOTS_PER_VISIT = 6;

/**
 * How much of each interval is skipped before the sweep starts sampling every tick.
 *
 * A quarter of a second short of `SAUCER_FIRE_INTERVAL`, so each shot is hunted
 * over thirty ticks rather than two hundred. Cost, not a bound, and it cannot bias
 * a reading: every round the sweep returns is one that appeared on a tick the sweep
 * itself ran and is read with the well's contribution held to a single tick. What a
 * lead-in can do is pass OVER a shot on a build that fires faster than it, which
 * changes WHICH shots are read and nothing about any of them — and the next
 * shot is then caught just the same. `fires-every-1p6s` is the item that decides
 * the cadence, and it skips nothing at all.
 */
export const LEAD_IN_TICKS = ticksFor(SAUCER_FIRE_INTERVAL - 0.25);

/** How long each shot is waited for before a silent gun is called on it. */
const SHOT_CEILING = ticksFor(4 * SAUCER_FIRE_INTERVAL);

/** Bring the saucer on at its stand, standing still, with only its gun running. */
async function standSaucer(h: Harness): Promise<void> {
  await poseSaucer(h, SAUCER_STAND.x, SAUCER_STAND.y, {
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
 * velocity is subtracted first, because `specs/saucer.md` has the round leave "at
 * `SAUCER_BULLET_SPEED` along that bearing, PLUS the saucer's own velocity" — here
 * the saucer is posed at rest, so the subtraction takes nothing away and says which
 * of the two quantities is being read. `bullet-carries-the-saucers-velocity` is the
 * item that poses a moving one.
 */
export async function readAimErrors(h: Harness): Promise<number[]> {
  await startPlaying(h);
  await h.debug.setShipPosition(SHIP_STAND.x, SHIP_STAND.y);
  await standSaucer(h);

  const wanted = bearingTo(SAUCER_STAND, SHIP_STAND);
  const errors: number[] = [];
  let held: number[] = [];
  for (let shot = 0; shot < SHOT_COUNT; shot += 1) {
    if (shot > 0 && shot % SHOTS_PER_VISIT === 0) {
      await standSaucer(h);
      held = (await h.snapshot()).enemyBullets.map((round) => round.id);
    }
    const volley = await nextVolley(h, held, {
      leadIn: LEAD_IN_TICKS,
      maxTicks: SHOT_CEILING,
    });
    held = volley.ids;
    const carried =
      volley.saucer === null ? { x: 0, y: 0 } : velocityOf(volley.saucer);
    const aim = bearingOf(subtract(velocityOf(volley.fired[0]), carried));
    errors.push(angleDelta(wanted, aim) / DEG);
  }
  return errors;
}
