// Shatter — posing a saucer that does nothing but shoot, and reading the rounds it
// takes, for the `saucer/*` points about the GUN.
//
// `specs/saucer.md` gives the saucer three separable faculties, and five points in
// this directory are about one of them: the cadence it fires on, the bearing it
// aims along, the bound on the error it adds, that the error is redrawn every
// shot, and the velocity it hands the round. Every one of them wants the same
// arrangement — a saucer standing still, deciding nothing, firing at a ship that
// does not move — and the same reading: the round's velocity on the sample it
// first appears on, which is its LAUNCH velocity.
//
// THE MIND AND THE TRAVEL ARE SHUT, THE GUN IS LEFT ON. `setSaucerTravel(false)`
// holds the craft's centre where it stands, so the bearing to the ship is one
// number for the whole scenario rather than one per shot;
// `setSaucerMind(false)` stops the weave rerolling the vertical velocity a round
// inherits. Both are the specification's own switches
// (`specs/instrumentation.md`), and the gun — the faculty every point here is
// about — is the one thing left running.
//
// THE VELOCITY IS POSED, NEVER LEFT AS IT LANDED. `addSaucer` brings the craft on
// "travelling right at `SAUCER_SPEED` with no vertical component", and a round
// leaves at `SAUCER_BULLET_SPEED` "plus the saucer's own velocity" — so a saucer
// left at its arrival cruise hands every round `140` units per second of sideways
// motion, which would tilt every bearing this module reports by seventeen degrees.
// A point about the AIM therefore poses the craft at rest, and the one point about
// the inheritance poses the course it means to read back.
//
// THE VISIT IS RENEWED, BECAUSE A VISIT IS FINITE. `specs/saucer.md` takes the
// saucer off the field `SAUCER_LIFETIME` (`12` s) after it enters and fires one
// round every `SAUCER_FIRE_INTERVAL` (`1.6` s), so a single visit yields seven
// rounds and no more. A point that wants sixty poses a fresh gunner the moment the
// slot reports clear — which is what {@link collectShots} does, at the same place
// and on the same course, so every round in the answer was aimed from one point at
// one ship.
//
// WHY THIS IS LOCAL TO THIS DIRECTORY. Nothing here is a threshold: the cadence,
// the error bound, the spread and the speed are each stated in the point that
// asserts them, derived from `specs/saucer.md`. What lives here is the one
// SCENARIO those five points share.

import { ConstantClock } from "@clockwyrks/structured-2d";
import { TICK_HZ } from "../constants";
import {
  clearCalls,
  createHarness,
  poseSaucer,
  TICK_MS,
  type Harness,
} from "../harness";
import { bearing, headingOf } from "../geometry";
import type { ShatterSnapshot } from "../surface";

/**
 * The whole simulation ticks one frame is worth when a run is watched for sixty
 * rounds.
 *
 * Sixty rounds at `SAUCER_FIRE_INTERVAL` is a hundred seconds of game time across
 * nine visits, which at one tick a frame is thirteen thousand renders. Four ticks
 * a frame is the same game — `specs/simulation.md` converts whatever delta a frame
 * brings into whole ticks, so an interval of game time reaches the same state
 * however it was divided — at a quarter of the drawing.
 *
 * WHAT THE STRIDE COSTS IS A LAUNCH READING UP TO THREE TICKS OLD. A round is
 * ballistic from the moment it leaves (`specs/saucer.md`: "It is pulled by the
 * well"), so a velocity read three ticks late carries the well's work over those
 * three ticks. The points that read a bearing state what that is worth in degrees
 * at the place they pose the gunner, and pose it far from the star so the figure
 * is a rounding error rather than a term. A point that wants a tick-exact reading
 * — the cadence — stands its harness up at the default clock instead.
 */
export const SHOT_TICKS_PER_FRAME = 4;

/**
 * How many frames may run between two emptyings of the render record.
 *
 * The harness records every call the render makes so the presentation points can
 * read them, and a hundred seconds of collection draws hundreds of thousands.
 * Nothing here reads a call, so the record is emptied as the collection runs.
 */
const RECORD_CHUNK = 120;

/** A harness whose every frame hands the game {@link SHOT_TICKS_PER_FRAME} ticks. */
export function createShotHarness(): Promise<Harness> {
  return createHarness({
    clock: new ConstantClock(TICK_MS * SHOT_TICKS_PER_FRAME),
  });
}

/** Where a gunner stands, and the course whose motion its rounds inherit. */
export interface GunPose {
  x: number;
  y: number;
  /** The velocity to pose. Rounds leave at `SAUCER_BULLET_SPEED` plus this. */
  vx: number;
  vy: number;
}

/**
 * A saucer that only shoots: posed at `pose`, its centre held, its mind shut, its
 * gun running — and its id.
 *
 * The three faculties are set one at a time because the surface gates them one at
 * a time (`specs/instrumentation.md`), and `setSaucerVelocity` follows `addSaucer`
 * because the arrival brings the craft on at its own cruise.
 */
export function poseGunner(h: Harness, pose: GunPose): number {
  const id = poseSaucer(h, pose.x, pose.y);
  h.debug.setSaucerVelocity(pose.vx, pose.vy);
  h.debug.setSaucerMind(false);
  h.debug.setSaucerTravel(false);
  return id;
}

/** One round, read on the first sample that reported it. */
export interface Shot {
  /** The round's own id. */
  id: number;
  /** The game time of that sample, in seconds. */
  seenAt: number;
  /** Its velocity there, which is its launch velocity plus the sample's lag. */
  vx: number;
  vy: number;
  /** The bearing that velocity runs along, in radians. */
  heading: number;
  /** The bearing from the saucer that fired it to the ship, in radians. */
  aimed: number;
  /** The velocity the saucer was carrying when it fired. */
  saucerVx: number;
  saucerVy: number;
}

/**
 * Drive until `count` rounds have been read, or `frames` frames have run, and
 * answer the rounds in the order they were taken.
 *
 * The gunner is re-posed at `pose` whenever the slot reports clear, so a visit
 * running out its `SAUCER_LIFETIME` costs one frame rather than ending the
 * collection. Every round is read on the first sample that carries it, which is
 * the only sample on which its velocity is (all but) the one it left at.
 */
export async function collectShots(
  h: Harness,
  pose: GunPose,
  count: number,
  frames: number,
): Promise<Shot[]> {
  const shots: Shot[] = [];
  const seen = new Set<number>();
  let from = { x: pose.x, y: pose.y, vx: pose.vx, vy: pose.vy };

  const read = (snapshot: ShatterSnapshot): void => {
    const saucer = snapshot.saucer;
    if (saucer !== null) {
      from = { x: saucer.x, y: saucer.y, vx: saucer.vx, vy: saucer.vy };
    }
    for (const round of snapshot.enemyBullets) {
      if (seen.has(round.id)) continue;
      seen.add(round.id);
      shots.push({
        id: round.id,
        seenAt: snapshot.simTime,
        vx: round.vx,
        vy: round.vy,
        heading: headingOf(round),
        aimed: bearing(from, snapshot.ship),
        saucerVx: from.vx,
        saucerVy: from.vy,
      });
    }
  };

  // Anything already in flight when the collection opens belongs to the
  // arrangement rather than to the reading.
  for (const round of h.snapshot().enemyBullets) seen.add(round.id);

  // UNDRAWN, BECAUSE THE READING IS A LIST OF VELOCITIES. The three aim items
  // read sixty rounds apiece, which is a minute and a half of game time sampled
  // a frame at a time so that no round is stepped over. The frames, the samples
  // and the rounds caught are the same either way; what is gone is the ten
  // thousand pictures none of them reads. Each item draws one frame of its own
  // for the still it captures.
  await h.quiet(async () => {
    for (let frame = 0; frame < frames && shots.length < count; frame += 1) {
      await h.advance(1);
      const snapshot = h.snapshot();
      read(snapshot);
      if (snapshot.saucer === null) poseGunner(h, pose);
      if (frame % RECORD_CHUNK === RECORD_CHUNK - 1) clearCalls(h);
    }
  });
  clearCalls(h);

  return shots;
}

/** The whole frames covering `seconds` of game time at `ticksPerFrame`. */
export function framesFor(seconds: number, ticksPerFrame: number): number {
  return Math.ceil((seconds * TICK_HZ) / ticksPerFrame);
}
