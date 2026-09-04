// insertion/stage — the staging every insertion check in this directory shares.
//
// WHY A SHARED STAGE. Six of the seven insertion points turn on WHERE a
// projectile's centre stands relative to a core's centre at the instant the
// strike resolves. `specs/injector.md` fixes that instant precisely:
//
//   "After it advances, a projectile is checked against every core on the
//    channel, at the positions the train holds after its own advance for that
//    tick."
//
// and `specs/channel.md` fixes the order — segments advance (step 2), then
// projectiles advance and strike (step 3). A check that poses a core before the
// shot is fired would have to predict a whole flight's worth of the train's
// advance to know where that core will be by the time the strike resolves.
//
// So every check here does the same thing: it fires, it lets the shot fly to a
// point one tick short of the channel, and only then poses the cores its
// requirement is about — at exactly the arc positions the strike must see.
// `poseTrain` "leaves the projectiles as they are" (specs/instrumentation.md), so
// the shot in flight is untouched, and a pose happens between ticks so no strike
// is checked against a core that has not yet had its tick.
//
// WHY THE POSED POSITION IS THE POSITION THE STRIKE SEES. The train's advance is
// a faculty none of these requirements exercises, so every check here holds it:
// `poseHall` is called with `feed: false`, which is `setFeed(false)` on the
// surface — "no segment advances, no merge follows from an advance ... Every
// other step runs unchanged while the train is held: timers fall, projectiles
// fly, a strike seats and the run it completes is extracted"
// (specs/instrumentation.md). A core posed at `s` therefore still stands at `s`
// on the tick the strike resolves, with nothing to pre-compensate for and no
// dependence on the feed rate, which is `channel/feed-advance`'s requirement and
// `channel/catchup-advance`'s rather than any of these.
//
// WHY THE SHOT IS ALWAYS AXIS-ALIGNED. One of the checks needs a geometry that
// holds to the last bit: `tie-break-forward` needs two centre distances that are
// EQUAL, and no approximate construction can promise that. A projectile "advances
// `PROJECTILE_SPEED` multiplied by the tick's elapsed time along its heading. The
// heading is fixed at firing and never turns, so a projectile travels in a
// straight line" (specs/injector.md), so a shot fired along `+x` (`RIGHT_AIM`,
// where the heading is exactly `(1, 0)`) keeps the injector's own `y` of 330 for
// its whole flight, whatever a build's arithmetic. That gives a check a line it
// knows exactly, and a pair of cores placed symmetrically about it are equidistant
// from every point of it — which is the only way to arrange a tie that is a tie
// rather than a coin toss between two distances that differ in their last bit.

import { assertEqual, assertGreaterThanOrEqual } from "../assert";
import { CHANNEL, CHANNEL_ARC, INJECTOR, type ChargeId } from "../constants";
import { fireAt, topRunS, type Harness, type VoluteSnapshot } from "../harness";

/* -------------------------------------------------------------------------- */
/* The two headings                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Straight up the field: the shot crosses the straight top run at `x = 420`.
 *
 * The same angle `specs/injector.md` opens the aim at ("Opening aim | 270
 * degrees"), which is why the injector at `(420, 330)` sits where it does
 * relative to leg 0.
 */
export const UP_AIM = 270;

/**
 * Straight along `+x`: the shot crosses leg 5, the vertical run at `x = 840`.
 *
 * The heading of a shot fired here is `(cos 0, sin 0)` — exactly `(1, 0)` — so the
 * flight holds the injector's `y` of 330 exactly, which is what
 * `tie-break-forward` builds its symmetry on.
 */
export const RIGHT_AIM = 0;

/* -------------------------------------------------------------------------- */
/* The two approaches                                                         */
/* -------------------------------------------------------------------------- */

/**
 * How far the sweep may run before the shot is called lost, in ticks.
 *
 * The longest approach here is the 420 units from the injector to leg 5, which at
 * `PROJECTILE_SPEED` (620 units/s) is 41 ticks. Double it, so a build whose
 * projectile is slow rather than absent still fails on the geometry it reached
 * rather than on the cap.
 */
const APPROACH_MAX = 90;

/**
 * The projectile `y` the vertical approach stops one tick short of.
 *
 * The top run sits at `y = 40` and the shot starts at `y = 330`, stepping
 * `620 / 60 = 10.33` units a tick, so the sample at or below this is the last one
 * clear of the run and the next lands within 1 unit of it. Anywhere in
 * `(40 + step, 40 + 2 x step)` would do; the middle of that band is chosen so a
 * build whose flight lands its samples half a step either side of the ideal still
 * stops on the same tick.
 */
const TOP_RUN_POSE_Y = 55;

/**
 * The projectile `x` the rightward approach stops one tick short of.
 *
 * Leg 5 stands at `x = 840` and the shot starts at `x = 420`, stepping
 * `620 / 60 = 10.33` units a tick, so the sample at or above this is the last one
 * whose next lands 7 units short of the leg — inside the 28-unit strike distance
 * with room to spare, and reached from a sample 27 units short of it, which is
 * outside. The value sits mid-band, so a build whose flight lands its samples half
 * a step either side of the ideal still stops on the same tick.
 */
const LEG5_POSE_X = 818;

/** The `y` the injector fixes for a shot fired along `+x`: it never changes. */
export const LEVEL_SHOT_Y = INJECTOR.y;

/** The `x` the injector fixes for a shot fired along `-y`: it never changes. */
export const PLUMB_SHOT_X = INJECTOR.x;

/** Leg 5's constant `x` — the vertical run from `(840, 120)` down to `(840, 420)`. */
export const LEG5_X = CHANNEL[5].x;

/** The arc position on leg 5 that stands at field `y`. */
export function leg5S(y: number): number {
  return CHANNEL_ARC[5] + (y - CHANNEL[5].y);
}

/** The arc position on the straight top run that stands at field `x`. */
export { topRunS };

/**
 * Fire along `aim` and step until the shot is ONE TICK short of its target run.
 *
 * Returns the snapshot of that tick. The caller poses its cores next, then steps
 * exactly one tick: the cores advance once, the projectile advances once, and the
 * strike resolves against the geometry the caller arranged.
 *
 * Fails the point when the shot never arrives, because a check whose shot never
 * flew cannot decide its requirement either way (`writing-debug-apis-and-
 * validators`: "A validator that cannot pose the world it needs ... fails the
 * item it decides").
 */
export async function approach(
  h: Harness,
  aim: typeof UP_AIM | typeof RIGHT_AIM,
): Promise<VoluteSnapshot> {
  await fireAt(h, aim);
  const swept = await h.stepUntil(
    (s) => {
      const shot = (s.projectiles ?? [])[0];
      if (shot === undefined) return false;
      return aim === UP_AIM ? shot.y <= TOP_RUN_POSE_Y : shot.x >= LEG5_POSE_X;
    },
    { maxTicks: APPROACH_MAX, poll: 1 },
  );
  assertEqual(
    swept.hit,
    true,
    "the fired core reaches the channel, flying at PROJECTILE_SPEED along the " +
      "aim it was fired on (specs/injector.md)",
  );
  return swept.snapshot;
}

/* -------------------------------------------------------------------------- */
/* The hall the approach is flown through                                     */
/* -------------------------------------------------------------------------- */

/**
 * The hall every approach is flown through: `poseHall(h, { feed: false, loaded:
 * SHOT })`.
 *
 * Nothing stands on the channel while the shot flies. `poseHall` holds the inlet
 * with `setEmission(false)` and leaves the level's quota where it stands, so no
 * core arrives and the clear specs/progression.md fires "the moment its quota is
 * exhausted and no cores remain on the channel" never comes up — which is what
 * lets the channel be genuinely empty, with no bystander core standing anywhere
 * in it, until the check poses the cores its requirement is about.
 */

/** The charge every check fires, distinct from the cores it poses. */
export const SHOT: ChargeId = "olivine";

/** Assert the shot is still in flight where the caller is about to pose. */
export function assertInFlight(snapshot: VoluteSnapshot): void {
  assertGreaterThanOrEqual(
    (snapshot.projectiles ?? []).length,
    1,
    "the fired core still in flight one tick short of the channel " +
      "(specs/injector.md: a projectile is discarded only when its centre " +
      "leaves the field or it strikes a core)",
  );
}
