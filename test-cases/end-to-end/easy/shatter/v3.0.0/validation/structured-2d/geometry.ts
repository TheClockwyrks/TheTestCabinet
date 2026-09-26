// Shatter — the spec-derived oracle. CASE-PROVIDED.
//
// Four rules in this game are stated in specs/ as REQUIREMENTS and never as
// algorithms — the wrap map, the shortest wrapped separation, the gravity law,
// and that no fast body passes through another in a tick — so how a build gets
// to them is the build's business and a validator needs its own arithmetic to
// hold it to them. That arithmetic is here.
//
// EVERY FUNCTION BELOW IS WRITTEN FROM THE SPECIFICATION, never read off a
// reference implementation. The figures come from `./constants`, this project's
// own transcription of the `specs/` pages, so the oracle holds the build to the
// specification's numbers rather than to whatever numbers the build wrote down
// for itself.
//
// Nothing here touches the engine, the harness, or a snapshot. These are plain
// functions over plain numbers, so a check can use one to predict a value, to
// place a scenario, or to read one back, and the harness itself uses them to
// place a round on a rock's doorstep.
//
// The three that a check will reach for by name:
//
//   shortestSeparation(a, b)   specs/field.md's shortest wrapped separation,
//                              which every distance in this game is measured by
//   gravityAt(p)               specs/gravity.md's law, exactly: MU / dEff^2
//                              toward the star, along the DIRECT vector
//   sweptContact(...)          specs/collision.md's continuous test: when, in a
//                              tick, two closing circles first touch

import {
  CORE_R,
  FIELD_H,
  FIELD_W,
  MU,
  SOFTEN,
  STAR_X,
  STAR_Y,
  TICK_DT,
} from "./constants";

/** A point or a velocity in the field's logical units. */
export interface Vec {
  x: number;
  y: number;
}

/** The star's centre, fixed at the field's centre for the whole game. */
export const STAR: Vec = { x: STAR_X, y: STAR_Y };

/* -------------------------------------------------------------------------- */
/* The wrap (specs/field.md)                                                  */
/* -------------------------------------------------------------------------- */

/**
 * A coordinate brought into `[0, size)`, which is what the wrap does to every
 * body's position at the end of every tick.
 *
 * The remainder is taken twice so a negative coordinate comes back positive:
 * `%` in JavaScript keeps the sign of the dividend, which for `-10 % 1280` is
 * `-10` rather than the `1270` the field's wrap means.
 */
export function wrapCoordinate(value: number, size: number): number {
  return ((value % size) + size) % size;
}

/** A position brought back into the field on both axes. */
export function wrapPoint(p: Vec): Vec {
  return {
    x: wrapCoordinate(p.x, FIELD_W),
    y: wrapCoordinate(p.y, FIELD_H),
  };
}

/**
 * One axis of the shortest wrapped separation: the difference brought into
 * `[-size / 2, +size / 2)`.
 *
 * This is the minimum-image convention specs/field.md fixes, and it is the
 * reason a body at `x = 10` and a body at `x = 1270` are `20` apart rather than
 * `1260`.
 */
export function shortestDelta(from: number, to: number, size: number): number {
  const half = size / 2;
  return wrapCoordinate(to - from + half, size) - half;
}

/** The shortest wrapped separation from `a` to `b`, as a vector. */
export function shortestSeparation(a: Vec, b: Vec): Vec {
  return {
    x: shortestDelta(a.x, b.x, FIELD_W),
    y: shortestDelta(a.y, b.y, FIELD_H),
  };
}

/**
 * The distance between two positions, measured the way every rule in this
 * specification measures one: along the shortest wrapped separation.
 */
export function wrappedDistance(a: Vec, b: Vec): number {
  const d = shortestSeparation(a, b);
  return Math.hypot(d.x, d.y);
}

/**
 * The separation from `a` to `b` WITHOUT the wrap — the plain difference.
 *
 * Used for the one measurement specs/gravity.md takes across the field
 * directly: the star's pull is along the body's direct vector to
 * `(STAR_X, STAR_Y)`, never a wrapped one, so a body near a corner is pulled by
 * its full distance across the field rather than by the distance to a wrapped
 * image of the star. A check about that distinction (`gravity/direct-not-wrapped`)
 * compares the two.
 */
export function directSeparation(a: Vec, b: Vec): Vec {
  return { x: b.x - a.x, y: b.y - a.y };
}

/** The plain, unwrapped distance between two positions. */
export function directDistance(a: Vec, b: Vec): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/* -------------------------------------------------------------------------- */
/* The gravity well (specs/gravity.md)                                        */
/* -------------------------------------------------------------------------- */

/**
 * The acceleration the star adds to a pulled body at `p`, in units per second
 * squared.
 *
 * The law exactly as specs/gravity.md states it:
 *
 *   d     = the DIRECT distance from the body's centre to (STAR_X, STAR_Y)
 *   dEff  = max(d, SOFTEN)
 *   aMag  = MU / (dEff * dEff)
 *   a     = aMag along the unit vector from the body toward the star's centre
 *
 * A body standing exactly on the star's centre has no direction to be pulled
 * along, so it is answered with no acceleration rather than with a division by
 * zero. Nothing in the game can reach that point — the core takes a rock and
 * absorbs a shot well outside it — so the case is arithmetic hygiene rather
 * than a rule.
 */
export function gravityAt(p: Vec): Vec {
  const dx = STAR_X - p.x;
  const dy = STAR_Y - p.y;
  const d = Math.hypot(dx, dy);
  if (d === 0) return { x: 0, y: 0 };
  const effective = Math.max(d, SOFTEN);
  const magnitude = MU / (effective * effective);
  return { x: (magnitude * dx) / d, y: (magnitude * dy) / d };
}

/** How hard the well pulls at `p`, in units per second squared. */
export function pullAt(p: Vec): number {
  const d = directDistance(p, STAR);
  const effective = Math.max(d, SOFTEN);
  return MU / (effective * effective);
}

/**
 * How much the well changes a pulled body's velocity over `seconds` of game
 * time, if the body stayed where it is — the first-order size of the confound a
 * scenario is inviting by posing a body at `p`.
 *
 * Fold-in fix C is the reason this is here: a scenario that reads a velocity it
 * arranged has to be posed where the well cannot have built a substantial part
 * of what it reads. Ask this before choosing a position, and read the answer
 * against the figure the check asserts.
 */
export function driftOver(p: Vec, seconds: number): number {
  return pullAt(p) * seconds;
}

/* -------------------------------------------------------------------------- */
/* Angles                                                                     */
/* -------------------------------------------------------------------------- */

/** Radians per degree, for the figures specs/ states in degrees. */
export const DEG = Math.PI / 180;

/** An angle brought into `(-PI, +PI]`. */
export function normalizeAngle(radians: number): number {
  const turn = Math.PI * 2;
  const brought = (((radians + Math.PI) % turn) + turn) % turn;
  return brought - Math.PI;
}

/**
 * The signed turn from `from` to `to`, in `(-PI, +PI]`: how far, and which way,
 * a heading has to swing to become the other. Positive is clockwise, because
 * the field's y axis runs down (specs/overview.md).
 */
export function angleDelta(from: number, to: number): number {
  return normalizeAngle(to - from);
}

/** The unsigned angle between two headings, in `[0, PI]`. */
export function angleBetween(a: number, b: number): number {
  return Math.abs(angleDelta(a, b));
}

/**
 * The bearing from `a` to `b` along the SHORTEST WRAPPED separation, in
 * radians. This is the bearing every rule that aims at a body means: the saucer
 * aiming at the ship, and — under `warhead` — a torpedo's forward cone.
 */
export function bearing(a: Vec, b: Vec): number {
  const d = shortestSeparation(a, b);
  return Math.atan2(d.y, d.x);
}

/** The heading a velocity is travelling along, in radians. */
export function headingOf(v: { vx: number; vy: number }): number {
  return Math.atan2(v.vy, v.vx);
}

/** The magnitude of a velocity, in units per second. */
export function speedOf(v: { vx: number; vy: number }): number {
  return Math.hypot(v.vx, v.vy);
}

/** The unit vector along `radians`. */
export function unit(radians: number): Vec {
  return { x: Math.cos(radians), y: Math.sin(radians) };
}

/* -------------------------------------------------------------------------- */
/* Swept contact (specs/collision.md)                                         */
/* -------------------------------------------------------------------------- */

/**
 * When, within a tick, two circles closing on each other first come within the
 * sum of their radii — or `null` if they never do over that tick.
 *
 * specs/collision.md mandates that collision be swept or continuous: two bodies
 * whose paths over a tick bring them within the sum of their radii at any point
 * of that tick collide on it, however fast either was travelling. This is that
 * test, solved for the earliest root of
 *
 *   |rel0 + relVel * t| = radii,   t in [0, dt]
 *
 * A pair that starts already overlapping answers `0`, which is the honest
 * reading of a contact that has already happened.
 *
 * `rel0` is the separation from the first body to the second — by the SHORTEST
 * WRAPPED separation, since bodies touching across a seam collide — and
 * `relVel` is the second body's velocity minus the first's.
 */
export function sweptContact(
  rel0: Vec,
  relVel: { vx: number; vy: number },
  radii: number,
  dt: number = TICK_DT,
): number | null {
  const a = relVel.vx * relVel.vx + relVel.vy * relVel.vy;
  const b = 2 * (rel0.x * relVel.vx + rel0.y * relVel.vy);
  const c = rel0.x * rel0.x + rel0.y * rel0.y - radii * radii;

  if (c <= 0) return 0;
  // Not closing at all: no relative motion, so the distance holds and `c > 0`
  // says it is already too far.
  if (a === 0) return null;

  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return null;
  const root = Math.sqrt(discriminant);
  // The earliest root is the first contact. The later one is the far side of
  // the pass, which a resolution never reaches.
  const t = (-b - root) / (2 * a);
  if (t < 0 || t > dt) return null;
  return t;
}

/**
 * Whether two circles moving at constant velocity touch at any point of one
 * tick — {@link sweptContact} read as the predicate a check states.
 */
export function sweptHit(
  a: { x: number; y: number; vx: number; vy: number },
  b: { x: number; y: number; vx: number; vy: number },
  radii: number,
  dt: number = TICK_DT,
): boolean {
  const rel0 = shortestSeparation(a, b);
  const relVel = { vx: b.vx - a.vx, vy: b.vy - a.vy };
  return sweptContact(rel0, relVel, radii, dt) !== null;
}

/**
 * How far apart two bodies' surfaces are: the shortest wrapped distance between
 * their centres, less the sum of their radii. Zero or below is contact.
 */
export function gap(
  a: Vec & { radius: number },
  b: Vec & { radius: number },
): number {
  return wrappedDistance(a, b) - (a.radius + b.radius);
}

/* -------------------------------------------------------------------------- */
/* The star's core                                                            */
/* -------------------------------------------------------------------------- */

/**
 * How far a body of `radius` is from touching the star's core: its distance to
 * the star's centre, less `CORE_R + radius`. Zero or below is contact, and the
 * ship at rest on the core sits at exactly `CORE_R + SHIP_R` from the centre.
 *
 * The distance to the core is a DIRECT one. The core is a body on the field
 * like any other, so this uses the wrapped separation — but the star stands at
 * the field's centre, further than half a field from every seam, so the two
 * readings coincide everywhere a body can be.
 */
export function coreGap(p: Vec, radius: number): number {
  return wrappedDistance(p, STAR) - (CORE_R + radius);
}

/**
 * A point's distance to the STRAIGHT LINE SEGMENT between two others.
 *
 * Fold-in fix B is why this is here. A sweep that samples a moving body every
 * few ticks and measures the samples reports the body further from the star
 * than it actually got — the closest point of an approach falls between two
 * samples far more often than on one — and for a check hunting a build that
 * came too close, that error runs in exactly the wrong direction. Measuring the
 * star's distance to the segment each pair of samples spans reads the whole of
 * the path the body took, at a stride a 36-crossing sweep can afford.
 *
 * A degenerate segment — two samples at the same point, which is a body that did
 * not move — answers the distance to that point.
 */
export function distanceToSegment(p: Vec, a: Vec, b: Vec): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lengthSquared = abx * abx + aby * aby;
  if (lengthSquared === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(
    0,
    Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / lengthSquared),
  );
  return Math.hypot(p.x - (a.x + t * abx), p.y - (a.y + t * aby));
}

/**
 * The closest the star's centre came to a path, read as the least distance to
 * any of the segments between consecutive samples.
 *
 * The samples are taken in field coordinates, so a path that crossed a seam has
 * one segment spanning the whole field. That segment is dropped rather than
 * measured: a body that left the right edge and re-entered at the left never
 * travelled the line between those two readings, and measuring it would report
 * an approach the body never made. A sample stride short enough to read a
 * crossing honestly is short enough that no real motion covers half a field, so
 * `wrappedDistance` between consecutive samples is what tells the two apart.
 */
export function closestApproachToStar(path: readonly Vec[]): number {
  let closest = Infinity;
  for (let i = 0; i < path.length; i += 1) {
    closest = Math.min(closest, directDistance(path[i], STAR));
    if (i === 0) continue;
    const from = path[i - 1];
    const to = path[i];
    // A seam crossing, not a straight run: the plain step is far longer than the
    // wrapped one, so there is no line between these two readings to measure.
    if (directDistance(from, to) > wrappedDistance(from, to) + 1e-9) continue;
    closest = Math.min(closest, distanceToSegment(STAR, from, to));
  }
  return closest;
}
