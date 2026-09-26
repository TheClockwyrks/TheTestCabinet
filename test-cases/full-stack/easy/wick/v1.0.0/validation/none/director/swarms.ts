// director/swarms — the gnat swarm the swarm checks read.
//
// WHERE THE GEOMETRY COMES FROM. specs/enemies.md ("Scripted events"): "A gnat
// swarm spawns `SWARM_SIZE` (`24`) gnats on the same tick along a line
// perpendicular to a direction `d`, a unit vector at an angle drawn uniformly
// over the full circle. The line is `SWARM_LINE` (`720`) units long, centered
// `SPAWN_DISTANCE` from the lamplighter along `d`, and the gnats are evenly
// spaced along it with one at each end:
//
//   center  = player + d * SPAWN_DISTANCE
//   perp    = (-dy, dx)
//   spacing = SWARM_LINE / (SWARM_SIZE - 1)
//   gnat i  = center + perp * (i - (SWARM_SIZE - 1) / 2) * spacing
//
// for `i` from `0` to `SWARM_SIZE - 1`."
//
// HOW `d` IS RECOVERED, AND WHY IT IS NOT ASSUMED. The direction is drawn, so a
// check that poses none may name no angle: an angle read off the reference
// would be a figure the specification never states. The formula gives it up
// instead. Summing the twenty-four positions cancels the perpendicular term —
// the offsets `(i − 11.5)` sum to zero over `i` from `0` to `23` — so the mean
// of the gnats is the line's `center`, and `d` is the unit vector from the
// lamplighter to it. Every figure a check asserts is then read against that
// recovered `d`, and a build that drew any angle at all is measured on its own.
// A check that poses the angle through `setNextSwarmAngle` reads the same
// recovery against the angle it posed.
//
// A check that reads a swarm reads the 1:00 one, `EVENTS`' first row, because
// it is the earliest and so the cheapest clock to pose; which tick each swarm
// fires on is the business of `swarm-1-00`, `swarm-4-00` and `swarm-7-00`.

import { assertEqual } from "../assert";
import { EVENTS, SWARM_SIZE } from "../constants";
import {
  player,
  unitToward,
  type EnemyView,
  type Harness,
  type WickSnapshot,
  type XY,
} from "../harness";
import { carryAcross, isolateForEvents } from "./events";

/** The swarm every swarm check reads: the earliest `EVENTS` row of its kind. */
const SWARM_EVENT = EVENTS.find((event) => event.kind === "swarm")!;

/** The run-clock second it fires on, from that row. */
export const SWARM_SECONDS = SWARM_EVENT.seconds;

/** The tick it fires on: `seconds × TICK_HZ`, from that row. */
export const SWARM_TICK = SWARM_EVENT.tick;

/** One spawned swarm, with the direction recovered from its own gnats. */
export interface Swarm {
  /** The state on the tick the swarm spawned. */
  fired: WickSnapshot;
  /** The twenty-four gnats, in id order. */
  gnats: EnemyView[];
  /** The lamplighter's center on that tick. */
  at: XY;
  /** The mean of the gnats, which the formula makes the line's center. */
  center: XY;
  /** The unit direction the line is centered along. */
  direction: XY;
  /** The unit vector `(-dy, dx)` the line runs along. */
  perp: XY;
}

/** The mean of `points`. */
function meanOf(points: readonly XY[]): XY {
  let x = 0;
  let y = 0;
  for (const point of points) {
    x += point.x;
    y += point.y;
  }
  return { x: x / points.length, y: y / points.length };
}

/**
 * Open an isolated night, carry it across the 1:00 swarm's tick, and read the
 * swarm it spawned. With `angle` given, the swarm's direction is posed through
 * `setNextSwarmAngle` first; otherwise the build draws it.
 */
export async function poseSwarm(h: Harness, angle?: number): Promise<Swarm> {
  await isolateForEvents(h);
  if (angle !== undefined) await h.debug.setNextSwarmAngle(angle);
  return readSwarm(h);
}

/** Carry the posed night across the 1:00 swarm's tick and read the swarm. */
export async function readSwarm(h: Harness): Promise<Swarm> {
  const crossing = await carryAcross(h, SWARM_TICK);
  assertEqual(
    crossing.arrivals.length,
    SWARM_SIZE,
    `gnats the swarm on tick ${SWARM_TICK} spawned`,
  );
  const gnats = crossing.arrivals;
  const at = player(crossing.fired);
  const center = meanOf(gnats);
  const direction = unitToward(at, center);
  assertEqual(
    direction !== null,
    true,
    "a swarm centered away from the lamplighter, so its direction is a unit vector",
  );
  const d = direction!;
  return {
    fired: crossing.fired,
    gnats,
    at,
    center,
    direction: d,
    perp: { x: -d.y, y: d.x },
  };
}
