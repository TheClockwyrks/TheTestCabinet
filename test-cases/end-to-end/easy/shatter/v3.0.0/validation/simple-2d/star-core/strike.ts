// Shatter — the one approach the five ship-and-core checks share, and the
// reading that finds the tick the contact resolved on. CASE-PROVIDED.
//
// `specs/collision.md` gives the core three resolutions and this group grades all
// three: a shot is absorbed, a rock is recycled, and the ship SLIDES. The three
// slide items — the distance it ends at, the tangential motion it keeps, the
// inward motion it loses — plus the facing item and the life item are all read off
// ONE contact, so the approach that produces it is built once, here, rather than
// five times over in checks that would drift apart.
//
// IT LIVES IN THE GROUP RATHER THAN IN `../harness.ts` because nothing outside
// `star-core` drives the ship at the core: the harness owns what the whole project
// shares (`startPlaying`, `aimedRound`, `closestApproach`), and this owns what
// these five share.
//
// NOT ONE FIGURE BELOW IS A BOUND. Everything here is geometry — where the ship
// starts, how fast it comes in, how far off the star's centre its line passes —
// and every tolerance stays in the check that asserts it, derived there from the
// figure `specs/collision.md` fixes for it.

import {
  CORE_R,
  SHIP_DRAG_HALFLIFE,
  SHIP_R,
  STAR_X,
  STAR_Y,
  TICK_DT,
} from "../constants";
import { fail } from "../assert";
import { STAR, distance, type Point } from "../geometry";
import { type Harness } from "../harness";
import type { ShatterSnapshot, ShipSnapshot } from "../surface";

/* -------------------------------------------------------------------------- */
/* The surface                                                                */
/* -------------------------------------------------------------------------- */

/**
 * How far from the star's centre a ship resting on the core stands: `44`.
 *
 * `specs/collision.md` step 1 of the slide: the ship's centre is pushed back out
 * to `CORE_R + SHIP_R` from `(STAR_X, STAR_Y)`. Named from the two constants
 * rather than written as `44`, so it is the specification's figure and not a
 * transcription of it.
 */
export const SURFACE = CORE_R + SHIP_R;

/** How far a body's centre is from the star's, across the seams (`specs/field.md`). */
export function distanceFromStar(body: Point): number {
  return distance({ x: body.x, y: body.y }, STAR);
}

/* -------------------------------------------------------------------------- */
/* The two approaches                                                         */
/* -------------------------------------------------------------------------- */

/**
 * How far off the star's centre the grazing approach's line passes: `20` units.
 *
 * OFF-CENTRE ON PURPOSE, and by this much. `specs/collision.md` splits the ship's
 * velocity at contact into a part along the surface, which is kept, and a part
 * into the core, which is removed, so a contact that had only one of the two
 * would leave half the rule ungraded. A line passing `20` from the centre meets
 * the `44`-unit surface at `sin = 20 / 44`, which is `27` degrees off head-on: the
 * kept part is a little under half the approach speed and the removed part a
 * little under all of it, so both are large figures and a build that confuses one
 * for the other cannot land inside either tolerance.
 */
export const IMPACT_OFFSET = 20;

/**
 * How fast the ship is driven at the core: `400` units per second.
 *
 * Well under `SHIP_MAX` (`680`, `specs/ship.md`), so nothing here rests on the cap
 * or on a build's ordering of it; fast enough that the whole run-in is a third of
 * a second, over which `specs/ship.md`'s drag — the only thing acting on a ship
 * holding no key, since `specs/gravity.md` never pulls one — bleeds off four per
 * cent of the speed.
 */
export const APPROACH_SPEED = 400;

/**
 * Where the grazing approach starts: on its line, `140` units short of contact.
 *
 * The line is `IMPACT_OFFSET` above the star's row, and the ship comes in along it
 * from the left. Its whole flight is inside the field with no seam near it, so the
 * still and the replay show one ship rather than a wrapped pair, and it is `220`
 * units from the ship's safe point at `(640, 560)`, which nothing in these
 * scenarios is standing on anyway.
 */
export const GRAZE_START: Point = { x: 460, y: STAR_Y - IMPACT_OFFSET };

/** The velocity the grazing approach carries: straight along its line, rightward. */
export const GRAZE_VELOCITY: Point = { x: APPROACH_SPEED, y: 0 };

/**
 * Where the head-on approach starts: `200` units straight above the star.
 *
 * The severest contact the field allows, and the one the two items that are about
 * the CONTACT rather than about the velocity split — `core-costs-no-life` and
 * nothing else here — are posed on. Driven straight at the centre, the ship's
 * whole velocity is the part heading into the core, so a conformant build takes
 * all of it off and leaves the ship standing ON the surface, in contact for every
 * remaining tick of the drive rather than for one.
 */
export const HEAD_ON_START: Point = { x: STAR_X, y: STAR_Y - 200 };

/** The velocity the head-on approach carries: straight down at the star's centre. */
export const HEAD_ON_VELOCITY: Point = { x: 0, y: APPROACH_SPEED };

/**
 * Stand the ship on the grazing approach, at rest in every faculty but its motion.
 *
 * The caller has already opened the empty, quiet field with `startPlaying`; this
 * changes where the ship is and how fast it is going, and nothing else. No key is
 * held for the whole of any drive, so `specs/ship.md`'s rotation and thrust never
 * run and the only force on the ship is its drag.
 */
export function poseGrazingApproach(h: Harness): void {
  h.debug.setShipPosition(GRAZE_START.x, GRAZE_START.y);
  h.debug.setShipVelocity(GRAZE_VELOCITY.x, GRAZE_VELOCITY.y);
}

/** Stand the ship on the head-on approach, on the same terms. */
export function poseHeadOnApproach(h: Harness): void {
  h.debug.setShipPosition(HEAD_ON_START.x, HEAD_ON_START.y);
  h.debug.setShipVelocity(HEAD_ON_VELOCITY.x, HEAD_ON_VELOCITY.y);
}

/* -------------------------------------------------------------------------- */
/* Driving in, and finding the contact                                        */
/* -------------------------------------------------------------------------- */

/** A drive at the core, sampled every tick. */
export interface Drive {
  /** The state after each tick, oldest first; index `0` is the pose itself. */
  path: ShatterSnapshot[];
  /** How near the ship's centre came to the star's centre over the whole drive. */
  closest: number;
}

/**
 * Drive the posed ship for `ticks`, reading the state after every one.
 *
 * Nothing here reads a velocity, a facing or a verdict: it runs the game and keeps
 * what it saw, and each check takes its own reading off the result. `closest` is
 * the one figure worth computing once, because two of the five want it — as the
 * reading itself, and as the evidence in a message.
 */
export async function driveIntoTheCore(
  h: Harness,
  ticks: number,
): Promise<Drive> {
  const path: ShatterSnapshot[] = [h.snapshot()];
  for (let tick = 1; tick <= ticks; tick += 1) {
    await h.advance(1);
    path.push(h.snapshot());
  }
  const closest = path.reduce(
    (least, snapshot) => Math.min(least, distanceFromStar(snapshot.ship)),
    Infinity,
  );
  return { path, closest };
}

/** The contact, as the two ticks that bracket it. */
export interface Contact {
  /** Ticks advanced before {@link at} was read. */
  tick: number;
  /** The state one tick earlier: the ship still on its way in. */
  before: ShatterSnapshot;
  /** The state on the tick the contact fell in. */
  at: ShatterSnapshot;
}

/**
 * What one tick of `specs/ship.md`'s drag leaves of a velocity, as a factor.
 *
 * The only thing that changes a driven ship's velocity while no key is held and
 * nothing has been touched: `specs/gravity.md` never pulls the ship, and thrust
 * and rotation need a key. Written from the specification's own two figures.
 */
const DRAG_PER_TICK = 0.5 ** (TICK_DT / SHIP_DRAG_HALFLIFE);

/**
 * A velocity change larger than this, in units per second, is the contact and not
 * the drag.
 *
 * A DETECTOR, NOT A BOUND. No item asserts it, and no requirement is stated in it.
 * One tick of drag takes a fifth of a unit per second off a ship travelling at
 * `APPROACH_SPEED`, and a build whose drag were wrong by half would still be
 * inside a couple of units per second; a contact on this approach takes off the
 * `360`-odd units per second heading into the core. `20` sits two orders below the
 * one and an order above the other, so nothing but a contact trips it.
 */
const CONTACT_IMPULSE = 20;

/**
 * How far past the surface a ship may be read and still count as touching it, in
 * units.
 *
 * Rounding room on `specs/collision.md`'s own touching test — two bodies touch when
 * their centres are within the sum of their radii — so a build that lands the ship
 * on `SURFACE` exactly is not missed for a last bit in the mantissa. It is a
 * thousandth of a unit against a sampling step of nearly three, so no tick of the
 * approach can fall inside it by accident.
 */
const TOUCHING_MARGIN = 0.001;

/**
 * The first tick of a drive that the contact fell in, and the tick before it.
 *
 * TWO SIGNS, EITHER OF WHICH IS THE CONTACT, because a build is entitled to resolve
 * it in more than one way and this must find the same tick for all of them.
 *
 * - The ship read TOUCHING the core, which is `specs/collision.md`'s own test:
 *   centres within the sum of the radii, `SURFACE`. A build that puts the ship back
 *   on the surface is read here on the tick it did it, and so is a build that
 *   resolved nothing at all and let the ship carry on into the core.
 * - The ship's velocity CHANGED by more than the drag, which catches the build the
 *   first sign would miss: one that pushes the ship out to a hair beyond the
 *   surface, so that it is never read touching, but takes the inward motion off
 *   exactly as the specification says.
 *
 * WHY NOT THE CLOSEST APPROACH. A build that resolves nothing has one too — at the
 * point its line passes nearest the star, where its velocity is entirely along the
 * surface and its inward component is momentarily zero. Reading there would report
 * that a build which removed nothing had removed the inward motion, and
 * `ship-loses-its-inward-speed` would pass every build alive. The contact is where
 * the specification puts it, which is where the circles meet.
 *
 * A drive that never touched the core and never changed course fails here: the
 * scenario did not happen, and no reading taken off it would mean anything.
 */
export function contactOf(drive: Drive): Contact {
  for (let tick = 1; tick < drive.path.length; tick += 1) {
    const before = drive.path[tick - 1].ship;
    const at = drive.path[tick].ship;
    const dragged = {
      vx: before.vx * DRAG_PER_TICK,
      vy: before.vy * DRAG_PER_TICK,
    };
    const impulse = Math.hypot(at.vx - dragged.vx, at.vy - dragged.vy);
    if (
      distanceFromStar(at) <= SURFACE + TOUCHING_MARGIN ||
      impulse > CONTACT_IMPULSE
    ) {
      return { tick, before: drive.path[tick - 1], at: drive.path[tick] };
    }
  }
  fail(
    "a ship driven at the star's core to reach it: its circle touching the " +
      `core's at ${SURFACE} units from the star's centre, or its course ` +
      "changed by the contact (specs/collision.md)",
    `over ${drive.path.length - 1} ticks the ship came no nearer than ` +
      `${drive.closest.toFixed(1)} units and held its course throughout`,
  );
}

/* -------------------------------------------------------------------------- */
/* Splitting a velocity at the surface                                        */
/* -------------------------------------------------------------------------- */

/**
 * The unit vector from the star's centre out to the ship: the surface's normal
 * where the ship stands.
 *
 * The direction `specs/collision.md` writes both halves of the slide against —
 * the ship is pushed back out ALONG it, and the velocity is split into the part
 * along it and the part across it. Taken from the ship's position at the CONTACT,
 * so the split is read against the surface the contact actually happened on rather
 * than against one the pose predicted.
 *
 * A ship standing exactly on the star's centre has no normal; that cannot arise
 * from either approach here, and `(1, 0)` is answered rather than a refusal so a
 * check still reaches a verdict.
 */
export function outwardNormal(ship: ShipSnapshot): Point {
  const dx = ship.x - STAR_X;
  const dy = ship.y - STAR_Y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return { x: 1, y: 0 };
  return { x: dx / length, y: dy / length };
}

/**
 * How much of a velocity runs ALONG the normal, signed positive OUTWARD.
 *
 * `specs/collision.md` removes "the component of the ship's velocity heading into
 * the core", which is this reading when it is negative. Signed rather than
 * unsigned, because zero and reversed are different answers and the item that
 * reads it must tell them apart.
 */
export function radialSpeed(ship: ShipSnapshot, normal: Point): number {
  return ship.vx * normal.x + ship.vy * normal.y;
}

/**
 * How much of a velocity runs ACROSS the normal, signed a quarter-turn clockwise
 * of it — the field's `y` axis running down (`specs/overview.md`).
 *
 * "The component along the surface", which `specs/collision.md` keeps unchanged.
 * Signed, so a build that kept the magnitude and reversed the direction is a
 * different answer from one that kept it.
 */
export function tangentialSpeed(ship: ShipSnapshot, normal: Point): number {
  return ship.vx * -normal.y + ship.vy * normal.x;
}
