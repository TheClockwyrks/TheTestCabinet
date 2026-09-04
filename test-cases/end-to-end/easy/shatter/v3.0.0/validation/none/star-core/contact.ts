// star-core — the one contact the four slide checks read, and the drive that makes
// it.
//
// LOCAL TO THIS GROUP ON PURPOSE. `validation/none/harness.ts` owns the compound
// sequences the whole project shares; the approach below is wanted only by the four
// `star-core` checks that read the slide, and keeping it beside them leaves the
// shared file alone.
//
// WHAT THE APPROACH IS, AND WHY IT IS OFF-CENTRE. `specs/collision.md` resolves the
// ship against the core in three parts — the centre pushed back out to
// `CORE_R + SHIP_R` (`44`), the velocity's inward component removed, its component
// along the surface kept, the facing left alone — and the manifest grades each of
// them separately, so a build that ZEROES the whole velocity and a build that
// REFLECTS it fail different points. A head-on approach cannot tell those two
// apart: with no tangential component to keep, "kept" and "zeroed" read the same
// number. So the ship is flown along a straight line whose closest approach to the
// star's centre is {@link IMPACT_PARAMETER} (`26`) rather than `0`, which puts
// `59` percent of its speed along the surface at the contact and `81` percent into
// the core. Every wrong model then reads as a different number:
//
//   | the build                       | tangential kept | inward left |
//   | ------------------------------- | --------------- | ----------- |
//   | the specification's slide       | all of it       | none        |
//   | zeroes the whole velocity       | none            | none        |
//   | reflects the velocity           | all of it       | all of it, outward |
//   | has no core at all              | all of it       | all of it, inward |
//
// NOTHING ELSE CAN MOVE EITHER READING. The well never pulls the ship
// (`specs/gravity.md`), no key is held so no thrust and no rotation act
// (`specs/ship.md`), and `startPlaying` has emptied every roster and shut both
// world gates, so the core is the only thing on the field the ship can meet. The
// one thing that does act is the drag, which multiplies the velocity by
// `0.5 ^ (TICK_DT / SHIP_DRAG_HALFLIFE)` — `0.19` percent a tick — and multiplies
// both components of it by the same factor, so it scales the speed and leaves the
// path a straight line and the impact parameter exactly what it was posed at.
//
// WHICH TICK IS THE CONTACT. The tick whose sample stands NEAREST the star's
// centre. For any build that resolves the contact at all, that is the resolution
// tick and no other: before it the ship closes every tick, and after it the ship
// leaves along the surface and never returns. Nothing about the build's own
// arithmetic enters — no epsilon it may have nudged the standoff by, no choice
// between a swept test and a test of where the tick ended.
//
// AND THE FRAME IS READ OFF THAT SAMPLE. `specs/collision.md` pushes the ship out
// "along the direction from the star's centre to the ship" and removes the
// component "heading into the core", which is the same direction; so the outward
// unit vector at the ship's resolved position IS the frame the specification
// resolved in, whatever position a build measured it from, because the push runs
// along it. Reading the frame from the build's own resolved position rather than
// from a direction this file made up is what keeps the two component checks from
// grading an implementation.

import { fail } from "../assert";
import { CORE_R, DEG, SHIP_R, STAR_X, STAR_Y } from "../constants";
import {
  closestApproach,
  normalize,
  perpendicular,
  starDistance,
  type Vec,
} from "../geometry";
import {
  centreOf,
  velocityOf,
  type Harness,
  type ShatterSnapshot,
} from "../harness";

/** The star's centre, as a point the geometry helpers take. */
export const STAR: Vec = { x: STAR_X, y: STAR_Y };

/**
 * How far the ship's centre stands from the star's when the two touch:
 * `CORE_R + SHIP_R` (`44`), the standoff `specs/collision.md` fixes.
 */
export const CLEARANCE = CORE_R + SHIP_R;

/**
 * Where the approach begins: a row `26` units above the star's, `100` units to the
 * left of its column.
 *
 * Clear of everything. Its distance from the star's centre is `103`, so the ship
 * starts well outside the `44` at which the core touches it; the field holds
 * nothing else; and the whole passage stays inside the field, so no reading of a
 * position crosses a seam.
 */
export const APPROACH_FROM = { x: 540, y: 334 } as const;

/**
 * The nearest the approach line passes the star's centre: `26` units.
 *
 * The one figure the whole scenario turns on. At `26` of the `44` the core touches
 * at, the contact normal stands `36.2` degrees off the ship's course, so `59`
 * percent of its speed lies along the surface and `81` percent into the core — two
 * substantial components, and two different numbers, which is what lets the four
 * wrong models in the table above read differently from one another.
 */
export const IMPACT_PARAMETER = STAR_Y - APPROACH_FROM.y;

/** The speed the ship is posed at, along the positive `x` axis. */
export const APPROACH_SPEED = 200;

/**
 * The facing the ship carries through the contact.
 *
 * Deliberately unrelated to anything the contact could align it with: `100` degrees
 * is at least `26` degrees from the course (`0`), from the contact normal and its
 * opposite (`216` and `36`), and from the surface tangent and its opposite (`306`
 * and `126`). So a build that turns the ship to face along its motion, out along
 * the normal, or around the surface reads a different angle from a build that
 * leaves the facing alone.
 */
export const CONTACT_FACING = 100 * DEG;

/**
 * The ticks a slide reading drives for: `55`.
 *
 * Long enough that the ship meets the core — the specification's own arithmetic
 * puts the contact at tick `41`, the ship having covered the `64.5` units from
 * {@link APPROACH_FROM} to the `44` circle at `APPROACH_SPEED` under the drag
 * `specs/ship.md` fixes — and short enough that a build with NO core at all is
 * still closing on the star when the drive ends, `13` units short of its closest
 * approach and carrying `45` percent of its speed straight into the core. That is
 * what stops `ship-loses-its-inward-speed` from passing on a build with no slide
 * at all: on such a build the nearest sample is the last one, taken while the ship
 * is still heading in, rather than the one at the bottom of a pass that never
 * happened.
 */
export const SLIDE_TICKS = 55;

/**
 * The ticks the standoff reading drives for: `130`.
 *
 * The same passage carried well past the contact, so the replay it leaves shows the
 * ship arriving, grazing and sliding free rather than stopping on the frame of the
 * measurement — and so a build that pushes the ship out and then lets it sink back
 * in is read as having sunk back in. A build with no core is `26` units from the
 * star's centre by the end of it, which is the reading that fails it.
 */
export const STANDOFF_TICKS = 130;

/** One tick's reading of the ship: where it stood, how it moved, where it faced. */
export interface ShipSample {
  /** The tick this was read on, `0` being the pose. */
  tick: number;
  /** The ship's centre. */
  at: Vec;
  /** The ship's velocity. */
  velocity: Vec;
  /** The ship's facing, in radians. */
  angle: number;
  /** Its centre's distance from the star's centre. */
  distance: number;
  /** The whole state that tick left, for a check that needs more of it. */
  snapshot: ShatterSnapshot;
}

/** The contact itself: the tick it happened on, and the frame it happened in. */
export interface Contact {
  /** The tick before it, whose velocity the contact acted on. */
  before: ShipSample;
  /** The tick it happened on, whose velocity and position it left. */
  after: ShipSample;
  /** The outward unit vector at the resolved position: away from the star. */
  normal: Vec;
  /** The unit vector along the core's surface there, a quarter turn from it. */
  tangent: Vec;
}

/** What one passage past the core leaves to be read. */
export interface Passage {
  /** Every tick of it, the pose first. */
  samples: ShipSample[];
  /** The nearest the ship's PATH came to the star's centre over the whole passage. */
  closest: number;
  /** The contact, or `null` where the ship never closed on the star at all. */
  contact: Contact | null;
}

/** One tick's reading, taken off a snapshot. */
function sampleOf(tick: number, snapshot: ShatterSnapshot): ShipSample {
  const at = centreOf(snapshot.ship);
  return {
    tick,
    at,
    velocity: velocityOf(snapshot.ship),
    angle: snapshot.ship.angle,
    distance: starDistance(at),
    snapshot,
  };
}

/**
 * Pose the approach: an empty, quiet, live field with the ship aimed past the core
 * at {@link IMPACT_PARAMETER}.
 *
 * It leaves the ship's lethal contact test where `startPlaying` shut it, because
 * three of the four checks that use this are about the velocity and the position
 * the slide leaves, and none of them is about what a contact costs.
 * `core-costs-no-life`, which IS about that, turns the gate back on itself.
 */
export async function poseTheApproach(h: Harness): Promise<void> {
  const { debug } = h;
  await debug.setShipPosition(APPROACH_FROM.x, APPROACH_FROM.y);
  await debug.setShipVelocity(APPROACH_SPEED, 0);
  await debug.setShipAngle(CONTACT_FACING);
}

/**
 * Run the posed approach for `ticks` ticks, reading the ship on every one of them,
 * and hand back the passage.
 *
 * Every tick is driven rather than marched, so a check that films this leaves a
 * replay of it and a check that photographs it finds the canvas showing the tick it
 * last ran.
 */
export async function driveIntoTheCore(
  h: Harness,
  ticks: number,
): Promise<Passage> {
  const samples: ShipSample[] = [sampleOf(0, await h.snapshot())];
  for (let tick = 1; tick <= ticks; tick += 1) {
    await h.advance(1);
    samples.push(sampleOf(tick, await h.snapshot()));
  }

  let nearest = 0;
  for (let i = 1; i < samples.length; i += 1) {
    if (samples[i].distance < samples[nearest].distance) nearest = i;
  }

  const contact =
    nearest === 0 ? null : contactAt(samples[nearest - 1], samples[nearest]);

  return {
    samples,
    // The distance to the LINE between consecutive samples rather than to the
    // samples: the ship covers a unit and two thirds a tick, and a reading taken
    // at the samples alone reports it further out than it got, which is the wrong
    // direction for a check hunting a build that let it in too far.
    closest: closestApproach(
      samples.map((sample) => sample.at),
      STAR,
    ),
    contact,
  };
}

/** The contact between two consecutive samples, in the frame the later one fixes. */
function contactAt(before: ShipSample, after: ShipSample): Contact {
  const normal = normalize({ x: after.at.x - STAR_X, y: after.at.y - STAR_Y });
  return { before, after, normal, tangent: perpendicular(normal) };
}

/**
 * The contact a slide check reads, failing the check when the ship never closed on
 * the star at all.
 *
 * A passage whose nearest sample is the pose is one in which the ship never moved
 * toward the core — the scenario was never reached, rather than reached and
 * answered wrongly — so it fails with what the scenario needed named.
 */
export function requireContact(passage: Passage, scenario: string): Contact {
  if (passage.contact === null) {
    fail(
      `${scenario}: a ship driven at the star's core closing on it (specs/collision.md)`,
      `the ship never came nearer than the ${passage.samples[0].distance.toFixed(1)} units it was posed at`,
    );
  }
  return passage.contact;
}
