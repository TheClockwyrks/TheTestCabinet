// Shatter — the quiet corners of the field the `torpedo` checks fly in, the
// readings a torpedo is taken from, and the poses that put a ship where a launch
// can be watched. CASE-PROVIDED.
//
// LOCAL ON PURPOSE. `../harness.ts` owns the compound sequences the whole project
// shares, and it can only know the surface EVERY variant has; what is here is
// wanted only by the twenty-one `torpedo` checks, which never load against a
// `base` build, so keeping it beside them leaves the shared file alone. The
// `detonation` group keeps its own `scenario.ts` next door for the same reason:
// that group flies a torpedo INTO something, this one flies it to read how it
// travels and what it steers at.
//
// EVERY READING BELOW IS A HARD ONE, and that is the fold-in fix this group was
// largely about. Two v2.0.2 assertions dereferenced a torpedo whose existence they
// had only soft-checked, so a build that launched nothing crashed the script and
// was misreported as failing to expose the debug surface. An entity a check then
// reads is asserted first, with the specification's own requirement named, so such
// a build fails the item that decides the launch — `the-torpedo-action-launches-one`
// — and nothing else.
//
// NOT ONE FIGURE HERE IS A BOUND. Everything below is geometry, a pose, or a hard
// reading. What counts as close enough is each check's own figure, stated in that
// check beside the specification rule it serves.

import { DEG, TICK_DT } from "../../src/constants";
import { fail } from "../assert";
import { separation, wrap, type Point, type Velocity } from "../geometry";
import {
  poseTorpedo,
  tapAction,
  torpedoesOf,
  type Harness,
} from "../harness";
import type { ShatterSnapshot, TorpedoSnapshot } from "../surface";

/* -------------------------------------------------------------------------- */
/* Where this group flies                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Where a ship is posed when the check is about the launch itself: `(200, 200)`.
 *
 * `468` units from the star's centre, clear of the star's whole drawn extent
 * (nothing of it is drawn beyond `180`, `specs/field.md`), off both axes, and far
 * enough out that the well's pull here is `MU / 468^2`, some `21` units per second
 * squared — which moves nothing by a tenth of a unit over the two ticks a launch
 * check runs for. The ship is never pulled at all (`specs/gravity.md`), so it
 * stands exactly where it is put.
 */
export const LAUNCH_SPOT: Point = { x: 200, y: 200 };

/**
 * The facing a launch check poses, in radians.
 *
 * `-35` degrees: neither an axis, nor the bearing from {@link LAUNCH_SPOT} to the
 * star (`20` degrees), so a build that launches "up the field" or "toward the
 * middle" rather than along the facing reads as a different number rather than
 * passing by coincidence. The ray from there never comes nearer the star's centre
 * than `384` units, so nothing a launch check flies can be absorbed by the core.
 */
export const LAUNCH_FACING = -35 * DEG;

/**
 * The lane a straight-flight check flies along: the bottom of the field.
 *
 * `690` is `330` units below the star's row, so a torpedo crossing the whole width
 * here never comes within `330` units of the star's centre — eleven times the
 * `CORE_R + TORPEDO_R` (`36`) at which it would be absorbed (`specs/collision.md`)
 * — and it is clear of the safe point `startPlaying` leaves the ship on,
 * `(640, 560)`.
 */
export const LANE_Y = 690;

/** Where a flight down the bottom lane begins: clear of the left seam. */
export const LANE_X = 140;

/**
 * The column a guidance check flies down: the left edge of the field.
 *
 * A torpedo posed at `(140, 60)` heading down the field, with its target a few
 * hundred units ahead of it, keeps the whole scenario more than `400` units from
 * the star — so the well is not what moves anything a guidance check reads, and no
 * torpedo of this group ever approaches the core.
 */
export const COLUMN: Point = { x: 140, y: 60 };

/** Straight down the field, in radians: the heading a guidance check is posed on. */
export const HEADING_DOWN = 90 * DEG;

/** Straight across the field to the right, in radians. */
export const HEADING_RIGHT = 0;

/**
 * The lane a long guidance shot flies: across the top of the field.
 *
 * THE FIELD IS A TORUS, AND THAT BOUNDS HOW FAR AHEAD A TARGET MAY BE POSED.
 * `specs/weapons.md` takes a candidate's bearing from the SHORTEST WRAPPED
 * separation, and the field is `1280` by `720`, so a body more than `360` units
 * down the field is nearer the other way and its bearing points BACKWARD — a target
 * posed there is behind the torpedo, not ahead of it, and no conformant build
 * acquires it. A shot that wants a target several hundred units ahead therefore
 * runs along `x`, where the half-width is `640`, and keeps its `y` excursion small.
 * Nothing posed on this lane comes within `240` units of the star's centre, so the
 * well moves a target rock by a fraction of a unit over the ticks a guidance check
 * reads, and moves the torpedo not at all.
 */
export const TOP_LANE: Point = { x: 100, y: 120 };

/** The unit vector along `bearing`, in radians. */
export function unitAt(bearing: number): Point {
  return { x: Math.cos(bearing), y: Math.sin(bearing) };
}

/** The point `distance` units from `from` along `bearing`, kept on the field. */
export function pointAt(from: Point, bearing: number, distance: number): Point {
  const along = unitAt(bearing);
  return wrap({
    x: from.x + along.x * distance,
    y: from.y + along.y * distance,
  });
}

/** How much of `v` runs along the unit vector `axis`. */
export function componentAlong(v: Velocity, axis: Point): number {
  return v.vx * axis.x + v.vy * axis.y;
}

/** How much of `v` runs across the unit vector `axis`, a quarter turn clockwise. */
export function componentAcross(v: Velocity, axis: Point): number {
  return v.vx * -axis.y + v.vy * axis.x;
}

/* -------------------------------------------------------------------------- */
/* Hard readings                                                              */
/* -------------------------------------------------------------------------- */

/**
 * The one torpedo the scenario expects to be in flight, failing where there is not
 * exactly one.
 *
 * The hard reading fold-in fix D turned into a rule: what a check dereferences is
 * asserted first, so a build that launched nothing fails with the launch named
 * rather than crashing the file a line later.
 */
export function theTorpedo(
  snapshot: ShatterSnapshot,
  scenario: string,
): TorpedoSnapshot {
  const roster = torpedoesOf(snapshot);
  if (roster.length !== 1) {
    fail(
      `exactly one torpedo in flight (specs/weapons.md), for ${scenario}`,
      `the torpedo roster holds ${JSON.stringify(roster.map((t) => t.id))}`,
    );
  }
  return roster[0];
}

/**
 * The stored charge a `warhead` snapshot reports, failing where the build has
 * none.
 *
 * `torpedoCharge` is a required field of the shape under this variant
 * (`specs/instrumentation.md`), and every check in the charge half of this group
 * compares against it, so a build that omits it fails here with the field named
 * rather than reading `undefined` into an arithmetic comparison.
 */
export function chargeOf(snapshot: ShatterSnapshot, scenario: string): number {
  const charge = snapshot.torpedoCharge;
  if (typeof charge !== "number") {
    fail(
      "snapshot() to report the stored charge as `torpedoCharge` " +
        `(specs/instrumentation.md, warhead), for ${scenario}`,
      charge,
    );
  }
  return charge;
}

/** The `torpedoReady` flag, failing where the build does not report one. */
export function readyOf(snapshot: ShatterSnapshot, scenario: string): boolean {
  const ready = snapshot.torpedoReady;
  if (typeof ready !== "boolean") {
    fail(
      "snapshot() to report `torpedoReady` (specs/instrumentation.md, " +
        `warhead), for ${scenario}`,
      ready,
    );
  }
  return ready;
}

/** Whether the torpedo with that id is still in the roster. */
export function inFlight(snapshot: ShatterSnapshot, id: number): boolean {
  return torpedoesOf(snapshot).some((torpedo) => torpedo.id === id);
}

/** Whether the rock with that id is still on the field. */
export function rockStanding(snapshot: ShatterSnapshot, id: number): boolean {
  return snapshot.rocks.some((rock) => rock.id === id);
}

/* -------------------------------------------------------------------------- */
/* Poses                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Set the stored charge, failing by name where the build exposes no such
 * operation.
 *
 * `surface.ts` declares the torpedo operations optional only because ONE surface
 * serves both variants; `specs/instrumentation.md` owes every one of them to a
 * `warhead` build. A named failure here beats
 * `h.debug.setTorpedoCharge is not a function` a line later, and
 * `instrumentation/poses-read-back` is the item that GRADES the pose.
 */
export function setCharge(h: Harness, fraction: number): void {
  if (h.debug.setTorpedoCharge === undefined) {
    fail(
      "a setTorpedoCharge operation on the debug surface " +
        "(specs/instrumentation.md, warhead)",
      "undefined",
    );
  }
  h.debug.setTorpedoCharge(fraction);
}

/** Empty the torpedo roster, failing by name where the operation is missing. */
export function clearTorpedoes(h: Harness): void {
  if (h.debug.clearTorpedoes === undefined) {
    fail(
      "a clearTorpedoes operation on the debug surface " +
        "(specs/instrumentation.md, warhead)",
      "undefined",
    );
  }
  h.debug.clearTorpedoes();
}

/** Take one torpedo off the field, failing by name where the operation is missing. */
export function removeTorpedo(h: Harness, id: number): void {
  if (h.debug.removeTorpedo === undefined) {
    fail(
      "a removeTorpedo operation on the debug surface " +
        "(specs/instrumentation.md, warhead)",
      "undefined",
    );
  }
  h.debug.removeTorpedo(id);
}

/**
 * Put one torpedo up at `(x, y)` along `heading` with its GUIDANCE SHUT OFF, and
 * hand back its id.
 *
 * `specs/instrumentation.md`'s `setTorpedoHoming` gates the acquisition and the
 * turn alone, leaving the travel, the lifetime and the impacts running — so a
 * torpedo posed this way exercises how it TRAVELS and nothing else. Every check in
 * this group whose requirement is not the guidance poses its torpedo here, so a
 * build that would acquire something the check did not intend cannot confound the
 * reading. `instrumentation/torpedo-homing-gate` is the item that grades the gate
 * itself.
 */
export function poseStraight(
  h: Harness,
  x: number,
  y: number,
  heading: number,
): number {
  const id = poseTorpedo(h, x, y, heading);
  if (h.debug.setTorpedoHoming === undefined) {
    fail(
      "a setTorpedoHoming operation on the debug surface " +
        "(specs/instrumentation.md, warhead)",
      "undefined",
    );
  }
  h.debug.setTorpedoHoming(id, false);
  return id;
}

/** How a ship is posed for a check about what its torpedo key does. */
export interface ShipPose {
  /** Where it stands. Defaults to {@link LAUNCH_SPOT}. */
  at?: Point;
  /** Its facing, in radians. Defaults to {@link LAUNCH_FACING}. */
  facing?: number;
  /** Its velocity. Defaults to at rest. */
  vx?: number;
  vy?: number;
}

/**
 * Stand the ship where a launch can be watched, carrying whatever drift the caller
 * asked for, and answer where it stands.
 *
 * `startPlaying` leaves the ship at the safe point `(640, 560)` facing `FACE_UP`,
 * which is `200` units straight below the star — a torpedo launched from there
 * flies into the core and is absorbed (`specs/collision.md`), so the roster could
 * read empty a tick later for a reason that has nothing to do with the key. Every
 * check that presses the torpedo binding therefore moves the ship first, and this
 * is that move.
 */
export function poseShip(h: Harness, pose: ShipPose = {}): Point {
  const at = pose.at ?? LAUNCH_SPOT;
  h.debug.setShipPosition(at.x, at.y);
  h.debug.setShipVelocity(pose.vx ?? 0, pose.vy ?? 0);
  h.debug.setShipAngle(pose.facing ?? LAUNCH_FACING);
  return at;
}

/* -------------------------------------------------------------------------- */
/* Driving the binding                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Press the torpedo binding once, as a player does, and hand back the state the
 * press left behind.
 *
 * The ACTION, not the key: `specs/controls.md` binds the torpedo to the `b` action
 * under `warhead`, and `keyFor` reads the key off the seeded `BINDINGS` — the
 * `controls` group is where the binding itself is graded. `Harness.tap` presses,
 * runs the tick that delivers the press, releases and runs the tick that delivers
 * the release, so a build that answers the armed EDGE and one that answers the
 * HELD value both see one press and neither sees two.
 *
 * TWO TICKS RUN, AND EVERY CHECK THAT USES THIS ACCOUNTS FOR THEM. A torpedo
 * launched on the first has flown at most one tick — `TORPEDO_SPEED / TICK_HZ`,
 * three and a half units — by the time the snapshot is taken, and a charge spent on
 * the first has had at most two ticks of the refill added back.
 */
export async function pressTorpedo(h: Harness): Promise<ShatterSnapshot> {
  await tapAction(h, "b");
  return h.snapshot();
}

/** The ticks {@link pressTorpedo} runs: `Harness.tap`'s press tick and release tick. */
export const PRESS_TICKS = 2;

/* -------------------------------------------------------------------------- */
/* Flying one                                                                 */
/* -------------------------------------------------------------------------- */

/** What one torpedo did over a run of ticks, read a tick at a time. */
export interface Flight {
  /** Where it stood at each sample: the pose first, then one entry per tick run. */
  path: Point[];
  /** Its heading at each of those samples, in radians. */
  headings: number[];
  /** The velocity it REPORTED at each of those samples, in units per second. */
  velocities: Velocity[];
  /** The speed it actually travelled at over each tick, in units per second. */
  speeds: number[];
  /** How far it travelled in all, in units. */
  distance: number;
  /** How many ticks ran before it left the roster, or `ticks` where it never did. */
  ticks: number;
}

/**
 * Fly one torpedo for `ticks` ticks, a tick at a time, and report where it went.
 *
 * THE SPEED IS READ FROM THE TRAVEL, NOT FROM THE REPORTED VELOCITY. A snapshot's
 * `vx`/`vy` is what the build says it is doing; the distance between two
 * consecutive positions is what it did. `specs/simulation.md` advances a position
 * by one tick of velocity, so on a conformant build the two agree exactly — and on
 * a build whose torpedo reports one thing and moves another, the reading that
 * decides `speed` is the one a player would see.
 *
 * Each step is measured across the shortest wrapped separation, so a tick that
 * carries the torpedo over a seam reads as the `TORPEDO_SPEED / TICK_HZ` it really
 * moved rather than as the width of the field.
 *
 * A tick at a time rather than in one batch, because a check that films its flight
 * needs a recorded frame per tick. It stops early where the torpedo leaves the
 * roster, so a caller reads what happened up to that moment rather than an
 * exception, and the torpedo is hard-asserted present before the first tick runs.
 */
export async function flyTorpedo(
  h: Harness,
  id: number,
  ticks: number,
): Promise<Flight> {
  const opening = h.snapshot();
  const start = torpedoesOf(opening).find((torpedo) => torpedo.id === id);
  if (start === undefined) {
    fail(
      `the torpedo ${id} in flight before the run begins ` +
        "(specs/instrumentation.md, warhead: addTorpedo appends one torpedo)",
      torpedoesOf(opening).map((torpedo) => torpedo.id),
    );
  }

  const path: Point[] = [{ x: start.x, y: start.y }];
  const headings: number[] = [start.heading];
  const velocities: Velocity[] = [{ vx: start.vx, vy: start.vy }];
  const speeds: number[] = [];
  let distance = 0;
  let ran = 0;

  for (let tick = 0; tick < ticks; tick += 1) {
    await h.advance(1);
    const flown = torpedoesOf(h.snapshot()).find(
      (torpedo) => torpedo.id === id,
    );
    if (flown === undefined) break;
    const previous = path[path.length - 1];
    const step = separation(previous, { x: flown.x, y: flown.y });
    const travelled = Math.hypot(step.x, step.y);
    path.push({ x: flown.x, y: flown.y });
    headings.push(flown.heading);
    velocities.push({ vx: flown.vx, vy: flown.vy });
    speeds.push(travelled / TICK_DT);
    distance += travelled;
    ran += 1;
  }
  return { path, headings, velocities, speeds, distance, ticks: ran };
}
