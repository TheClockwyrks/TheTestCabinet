// torpedo — the quiet corners of the field this group flies in, the readings a
// torpedo is taken from, and the poses that put a ship where a launch can be
// watched. Local to this group.
//
// LOCAL ON PURPOSE. `validation/none/harness.ts` owns the compound sequences the
// whole project shares; what is here is wanted only by the twenty-one `torpedo`
// checks, and keeping it beside them leaves the shared file alone.
//
// EVERY READING BELOW IS A HARD ONE, and that is the fold-in fix this group was
// largely about. Two v2.0.2 assertions dereferenced a torpedo whose existence they
// had only soft-checked, so a build that launched nothing crashed the script and
// was misreported as failing to expose the debug surface. An entity a check then
// reads is asserted first, with the specification's own requirement named, so such
// a build fails the item that decides the launch and nothing else.
//
// NO THRESHOLD LIVES HERE. What counts as close enough is each check's own figure,
// stated in the check beside the specification rule it serves.

import { fail } from "../assert";
import { DEG, KEY_TORPEDO, TICK_DT } from "../constants";
import { magnitude, shortestDelta, unitAt, wrap, type Vec } from "../geometry";
import {
  requireTorpedo,
  torpedoById,
  type Harness,
  type ShatterSnapshot,
  type TorpedoView,
} from "../harness";

/**
 * Where a ship is posed when the check is about the launch itself.
 *
 * `468` units from the star's centre, clear of the star's whole drawn extent
 * (nothing of it is drawn beyond `180`, `specs/field.md`), off both axes, and far
 * enough out that the well's pull here is `MU / 468^2`, some `21` units per second
 * squared — which moves nothing by a tenth of a unit over the one or two ticks a
 * launch check runs for. The ship is never pulled at all (`specs/gravity.md`), so
 * it stands exactly where it is put.
 */
export const LAUNCH_SPOT: Vec = { x: 200, y: 200 };

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
 * — and it is clear of the safe point the ship stands at, `(640, 560)`.
 */
export const LANE_Y = 690;

/**
 * The column a guidance check flies down: the left edge of the field.
 *
 * A torpedo posed at `(140, 60)` heading down the field, with its target a few
 * hundred units ahead of it, keeps the whole scenario more than `400` units from
 * the star — so the well is not what moves anything a guidance check reads, and no
 * torpedo of this group ever approaches the core.
 */
export const COLUMN: Vec = { x: 140, y: 60 };

/** Straight down the field, in radians: the heading a guidance check is posed on. */
export const HEADING_DOWN = 90 * DEG;

/** Straight across the field to the right, in radians. */
export const HEADING_RIGHT = 0;

/**
 * The lane a long guidance shot flies: across the top of the field.
 *
 * THE FIELD IS A TORUS, AND THAT BOUNDS HOW FAR AHEAD A TARGET MAY BE POSED.
 * specs/weapons.md takes a candidate's bearing from the SHORTEST WRAPPED
 * separation, and the field is `1280` by `720`, so a body more than `360` units
 * down the field is nearer the other way and its bearing points BACKWARD — a
 * target posed there is behind the torpedo, not ahead of it, and no conformant
 * build acquires it. A shot that wants a target several hundred units ahead
 * therefore runs along `x`, where the half-width is `640`, and keeps its `y`
 * excursion small. This lane is `240` units above the star's row and its whole
 * span stays more than `340` units from the star's centre.
 */
export const TOP_LANE: Vec = { x: 100, y: 120 };

/** The point `distance` units from `from` along `bearing`, kept on the field. */
export function pointAt(from: Vec, bearing: number, distance: number): Vec {
  const along = unitAt(bearing);
  return wrap({
    x: from.x + along.x * distance,
    y: from.y + along.y * distance,
  });
}

/**
 * The torpedo roster a `warhead` snapshot reports, failing where the build has
 * none.
 *
 * `specs/instrumentation.md` puts `torpedoes` in the snapshot shape under this
 * variant, so a build that omits it is answering wrongly rather than leaving a
 * check undecided.
 */
export function torpedoRoster(
  snapshot: ShatterSnapshot,
  scenario: string,
): TorpedoView[] {
  const { torpedoes } = snapshot;
  if (!Array.isArray(torpedoes)) {
    fail(
      `${scenario}: a snapshot reporting its torpedo roster (specs/instrumentation.md)`,
      torpedoes,
    );
  }
  return torpedoes;
}

/**
 * The one torpedo the scenario expects to be in flight, failing where there is not
 * exactly one.
 *
 * The hard reading fold-in fix D turned into a rule: what is dereferenced is
 * asserted first, so a build that launched nothing fails with the launch named.
 */
export function theTorpedo(
  snapshot: ShatterSnapshot,
  scenario: string,
): TorpedoView {
  const roster = torpedoRoster(snapshot, scenario);
  if (roster.length !== 1) {
    fail(
      `${scenario}: exactly one torpedo in flight (specs/weapons.md)`,
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
      `${scenario}: a snapshot reporting torpedoCharge (specs/instrumentation.md)`,
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
      `${scenario}: a snapshot reporting torpedoReady (specs/instrumentation.md)`,
      ready,
    );
  }
  return ready;
}

/** How a ship is posed for a check about what its torpedo key does. */
export interface ShipPose {
  /** Where it stands. Defaults to {@link LAUNCH_SPOT}. */
  at?: Vec;
  /** Its facing, in radians. Defaults to {@link LAUNCH_FACING}. */
  facing?: number;
  /** Its velocity. Defaults to at rest. */
  vx?: number;
  vy?: number;
}

/**
 * Stand the ship where a launch can be watched, carrying whatever drift the caller
 * asked for.
 *
 * `startPlaying` leaves the ship at the safe point `(640, 560)` facing up the
 * field, which is `200` units straight below the star — a torpedo launched from
 * there flies into the core and is absorbed (`specs/collision.md`). Every check
 * that presses the torpedo key therefore moves the ship first, and this is that
 * move.
 */
export async function poseShip(h: Harness, pose: ShipPose = {}): Promise<Vec> {
  const at = pose.at ?? LAUNCH_SPOT;
  await h.debug.setShipPosition(at.x, at.y);
  await h.debug.setShipVelocity(pose.vx ?? 0, pose.vy ?? 0);
  await h.debug.setShipAngle(pose.facing ?? LAUNCH_FACING);
  return at;
}

/**
 * Press the torpedo key once, as a player does, and hand back the state the tick
 * it was delivered on left behind.
 *
 * `specs/controls.md` reads the torpedo as a press alone — "one launch per press,
 * with no repeat while the key is held" — so a press edge is the whole of the
 * input, and {@link Harness.tap} is exactly one: key down, the one tick that
 * delivers it, key up.
 */
export async function pressTorpedo(h: Harness): Promise<ShatterSnapshot> {
  await h.tap(KEY_TORPEDO);
  return h.snapshot();
}

/** What one torpedo did over a run of ticks, read a tick at a time. */
export interface Flight {
  /** Where it stood at each sample, the pose first, then one entry per tick run. */
  path: Vec[];
  /** Its heading at each of those samples, in radians. */
  headings: number[];
  /** The velocity it REPORTED at each of those samples, in units per second. */
  velocities: { vx: number; vy: number }[];
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
 * consecutive positions is what it did. specs/simulation.md advances a position by
 * one tick of velocity, so on a conformant build the two agree exactly — and on a
 * build whose torpedo reports one thing and moves another, the reading that decides
 * `speed` is the one a player would see.
 *
 * Each step is measured across the shortest wrapped separation, so a tick that
 * carries the torpedo over a seam reads as the `TORPEDO_SPEED / TICK_HZ` it really
 * moved rather than as the width of the field.
 *
 * A tick at a time rather than in one batch, because a check that films its flight
 * needs a recorded frame per tick and {@link Harness.advance} is what closes one.
 * It stops early where the torpedo leaves the roster, so a caller reads what
 * happened up to the impact rather than an exception.
 */
export async function flyTorpedo(
  h: Harness,
  id: number,
  ticks: number,
): Promise<Flight> {
  const start = requireTorpedo(
    await h.snapshot(),
    id,
    "the flight being flown",
  );
  const path: Vec[] = [{ x: start.x, y: start.y }];
  const headings: number[] = [start.heading];
  const velocities: { vx: number; vy: number }[] = [
    { vx: start.vx, vy: start.vy },
  ];
  const speeds: number[] = [];
  let distance = 0;
  let ran = 0;

  for (let tick = 0; tick < ticks; tick += 1) {
    await h.advance(1);
    const flown = torpedoById(await h.snapshot(), id);
    if (flown === undefined) break;
    const step = magnitude(shortestDelta(path[path.length - 1], flown));
    path.push({ x: flown.x, y: flown.y });
    headings.push(flown.heading);
    velocities.push({ vx: flown.vx, vy: flown.vy });
    speeds.push(step / TICK_DT);
    distance += step;
    ran += 1;
  }
  return { path, headings, velocities, speeds, distance, ticks: ran };
}
