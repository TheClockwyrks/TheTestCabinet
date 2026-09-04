// Shatter — the placements and the compounds the `detonation` checks share.
// CASE-PROVIDED.
//
// This group decides two pairs of specs/collision.md: a torpedo and a rock, and a
// torpedo and the saucer. Every check in it therefore arranges the same shape — a
// body standing on quiet ground, and one torpedo placed on its doorstep and flown
// into it — so that shape is built once, here, rather than ten times over in ten
// checks that would drift apart.
//
// IT LIVES IN THE GROUP RATHER THAN IN `../harness.ts` because nothing outside
// `detonation` poses it: the `torpedo` group flies torpedoes to read their
// guidance, their turn rate and their lifetime, never to land one. The harness
// owns what the whole project shares; this owns what this group shares.
//
// NOT ONE FIGURE BELOW IS A BOUND. Everything here is geometry — a position, a
// heading, a standoff — and every tolerance stays in the check that asserts it,
// derived there from the figure specs/ fixes for it.

import { fail } from "../assert";
import {
  STAR_X,
  STAR_Y,
  TICK_HZ,
  TORPEDO_R,
  TORPEDO_SPEED,
  type RockSize,
} from "../constants";
import {
  angleBetween,
  bearingOf,
  normalize,
  pullMagnitude,
  scale,
  starDistance,
  subtract,
  unitAt,
  wrap,
  type Vec,
} from "../geometry";
import {
  ROUND_STANDOFF,
  poseTorpedo,
  ticksFor,
  torpedoById,
  velocityOf,
  type Harness,
  type RockView,
  type ShatterSnapshot,
  type Target,
} from "../harness";

/* -------------------------------------------------------------------------- */
/* Quiet ground                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Where every scenario in this group stands its target: `(320, 620)`.
 *
 * `412` units from the star, where specs/gravity.md's well pulls at about `26`
 * units per second squared — so over the eighth of a second a torpedo spends
 * crossing its standoff, the well adds around three units per second to whatever
 * the check arranged. That matters here more than anywhere else: the two scatter
 * items read a VELOCITY the detonation wrote, and the previous version of this
 * case posed its parent rock where the well had moved that velocity substantially
 * over the shots, so the item read a drift gravity had built rather than the one
 * it arranged. Standing far out is half of that repair; reading the PAIR
 * ({@link kickOf}) is the other half, and together they leave nothing of the well
 * in the figure.
 */
export const QUIET_GROUND: Vec = { x: 320, y: 620 };

/** What the well pulls with at {@link QUIET_GROUND}, in units per second squared. */
export const QUIET_PULL: number = pullMagnitude(starDistance(QUIET_GROUND));

/** What the well adds to a body's velocity at {@link QUIET_GROUND} over `seconds`. */
export function quietDrift(seconds: number): number {
  return QUIET_PULL * seconds;
}

/* -------------------------------------------------------------------------- */
/* Putting a torpedo on a body's doorstep                                     */
/* -------------------------------------------------------------------------- */

/** Where a torpedo's centre starts, measured from the target's centre. */
export function torpedoReach(radius: number): number {
  return radius + TORPEDO_R + ROUND_STANDOFF;
}

/** The seconds a torpedo takes to cross that standoff into a body standing still. */
export function approachSeconds(radius: number): number {
  return torpedoReach(radius) / TORPEDO_SPEED;
}

/** One tick of a torpedo's travel, in units. */
export const TORPEDO_TICK_TRAVEL = TORPEDO_SPEED / TICK_HZ;

/** A torpedo's launch: a centre, and the heading it will hold. */
export interface Approach {
  x: number;
  y: number;
  heading: number;
}

/**
 * The launch that puts a torpedo on `target`'s doorstep travelling along `heading`.
 *
 * The same properties `aimedRound` gives a bullet, for the same reasons: the whole
 * flight is the standoff, so nothing can happen to the torpedo on the way in; it
 * begins clear of the body's surface, so what resolves the hit is the build's own
 * swept collision pass rather than an overlap the pose created; and it is aimed
 * dead through the centre.
 *
 * `heading` is the caller's, because half of this group's scenarios want a
 * particular line — a horizontal shot the fan's direction can be read against, or
 * one that cannot reach a bystander — and the other half only want the star out of
 * the way, which is {@link inwardHeading}. It carries none of the target's
 * velocity: specs/weapons.md gives a torpedo `TORPEDO_SPEED` along its heading and
 * nothing else, so a caller that wants a head-on hit on a drifting body puts the
 * drift along the line rather than leading the shot.
 */
export function approach(target: Target, heading: number): Approach {
  const back = unitAt(heading);
  const reach = torpedoReach(target.radius);
  const at = wrap({
    x: target.x - back.x * reach,
    y: target.y - back.y * reach,
  });
  return { x: at.x, y: at.y, heading };
}

/**
 * The heading of an approach that begins on the side of `target` facing AWAY from
 * the star, so the torpedo cannot be absorbed by the core on its way in.
 *
 * specs/collision.md removes a torpedo that reaches the core, so a shot fired from
 * the far side across the star lands nothing and would grade the wrong rule. A
 * target standing on the star's own centre has no side facing away from it and is
 * given the `+x` one; nothing in this group poses one there.
 */
export function inwardHeading(target: { x: number; y: number }): number {
  const outward = normalize({ x: target.x - STAR_X, y: target.y - STAR_Y });
  const away = outward.x === 0 && outward.y === 0 ? { x: 1, y: 0 } : outward;
  return bearingOf(scale(away, -1));
}

/**
 * Put one torpedo on `target`'s doorstep along `heading` and hand back its id.
 *
 * Its guidance is off. specs/instrumentation.md's `setTorpedoHoming` gates the
 * acquisition and the turn alone, leaving the travel, the lifetime and the impacts
 * running — so a torpedo posed dead-on at a body it is already aimed through
 * exercises the IMPACT and nothing else. That is this group's requirement; the
 * `torpedo` group owns the guidance.
 */
export async function launchAt(
  h: Harness,
  target: Target,
  heading: number,
): Promise<number> {
  const start = approach(target, heading);
  return poseTorpedo(h, start.x, start.y, start.heading, { homing: false });
}

/* -------------------------------------------------------------------------- */
/* Flying it in                                                               */
/* -------------------------------------------------------------------------- */

/** What a torpedo's flight came to, and the two ticks that bracket its end. */
export interface TorpedoRun {
  /** Whether the torpedo left the roster within the sweep. */
  hit: boolean;
  /** Ticks driven to the sample it was gone on. */
  ticks: number;
  /**
   * The state on the last tick it was STILL IN FLIGHT.
   *
   * What a check reads the parent's velocity off, so nothing of what the well was
   * doing to the parent enters a figure the detonation wrote — and what
   * `absorbed-by-the-core` reads the torpedo's last position off, so a check can
   * say WHERE the flight ended and not merely that it did.
   */
  before: ShatterSnapshot;
  /** The state on the tick it LEFT the roster: the instant of the detonation. */
  at: ShatterSnapshot;
}

/**
 * Run the real simulation one tick at a time until the torpedo with that id is no
 * longer in flight, and report the tick it went on and the one before it.
 *
 * Every tick, because everything this group reads is read AT the detonation: the
 * rock that came apart, the score it paid, the fragments' velocities before the
 * well has had a chance to move them.
 */
export async function driveTorpedo(
  h: Harness,
  id: number,
  options: { maxTicks?: number } = {},
): Promise<TorpedoRun> {
  const maxTicks = options.maxTicks ?? ticksFor(1);
  let before = await h.snapshot();
  if (torpedoById(before, id) === undefined) {
    fail(
      "driveTorpedo: the torpedo it was handed still in flight (specs/instrumentation.md)",
      `the torpedo roster did not hold ${id} before a tick had run`,
    );
  }
  for (let ticks = 1; ticks <= maxTicks; ticks += 1) {
    const at = await h.advance(1);
    if (torpedoById(at, id) === undefined) {
      return { hit: true, ticks, before, at };
    }
    before = at;
  }
  return { hit: false, ticks: maxTicks, before, at: before };
}

/* -------------------------------------------------------------------------- */
/* Reading the fan                                                            */
/* -------------------------------------------------------------------------- */

/**
 * The two fragments a destroyed rock left, failing with what the scenario needed
 * when the roster does not hold exactly two of the size below it.
 *
 * specs/rocks.md fixes both the count and the size: a destroyed `large` leaves two
 * `medium`, a destroyed `medium` two `small`. Hard-asserted before either is read,
 * so a build that split into one — or into none — fails the item about splitting
 * rather than crashing the script two lines later.
 */
export function fragmentPair(
  snapshot: ShatterSnapshot,
  size: RockSize,
  scenario: string,
): [RockView, RockView] {
  const fragments = snapshot.rocks.filter((rock) => rock.size === size);
  if (fragments.length !== 2) {
    fail(
      `${scenario}: two ${size} fragments on the field (specs/rocks.md)`,
      `the rock roster held ${JSON.stringify(
        snapshot.rocks.map((rock) => rock.size),
      )}`,
    );
  }
  return [fragments[0], fragments[1]];
}

/**
 * Half the difference between two fragments' velocities: the kick one of them
 * took, with the parent's own motion cancelled.
 *
 * READ OFF THE PAIR, which is what makes it honest. specs/collision.md gives each
 * fragment the destroyed rock's velocity PLUS a kick, the two kicked to opposite
 * sides, so the difference between the two velocities is twice the kick and the
 * parent's motion — including every unit per second the well added to it — falls
 * out exactly.
 */
export function kickOf(a: RockView, b: RockView): Vec {
  return scale(subtract(velocityOf(a), velocityOf(b)), 0.5);
}

/** How far a bearing lies from an AXIS, in radians: never more than a quarter turn. */
export function axisOffset(bearing: number, axis: number): number {
  return Math.min(
    angleBetween(bearing, axis),
    angleBetween(bearing, axis + Math.PI),
  );
}

/** How far a vector's direction lies from an axis, in radians. */
export function axisOffsetOf(v: Vec, axis: number): number {
  return axisOffset(bearingOf(v), axis);
}
