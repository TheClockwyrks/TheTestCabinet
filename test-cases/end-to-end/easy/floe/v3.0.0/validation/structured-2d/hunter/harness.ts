// Floe (the hunter) — the readings only this group takes. CASE-PROVIDED.
//
// `validation/harness.ts` is shared by thirteen groups, so it carries what any of
// them could want: the engine, the clock, the poses, the roster lookups. What is
// here is the handful of readings the HUNTER's checks take and no other group
// does — a per-tick sample of the strait, a bear driven step after step along one
// axis, and the two questions `specs/hunter.md` asks about a tile.
//
// NOTHING HERE HOLDS A TOLERANCE. Every figure below is the specification's own,
// read out of `../constants`; the slack a check allows around a reading is
// that check's own business and is stated in the check, beside the figure it is
// slack on. `imminentlyCovered` therefore takes its margin as an argument rather
// than choosing one.
//
// AND NOTHING HERE ASSERTS A VERDICT, except where a reading cannot be taken at
// all: a bear that has left the roster is named by `requireBear`, so a check that
// wanted to measure one fails with the bear it wanted rather than with a
// `TypeError`.

import { BEAR_AVOID_LEAD, TILE, tileCX } from "../constants";
import { fail } from "../assert";
import {
  COARSE_TICKS,
  bearById,
  bearSettled,
  itemCoversPoint,
  laneAt,
  seconds,
  vehiclesOn,
  type BearSnapshot,
  type Facing,
  type FloeSnapshot,
  type Harness,
  type Tile,
} from "../harness";

/**
 * The bear with that id, or a failure naming the bear the check wanted.
 *
 * A bear can leave the roster for reasons the specification states — traffic
 * arriving on it, a crossing ending — so a check that reaches for one and finds
 * nothing has usually found the build doing something wrong rather than a hole in
 * its own arrangement. Either way the verdict belongs to the check, not to a
 * `TypeError` thrown deep in a helper, so the reading fails here saying which bear
 * it was after and what it was doing with it.
 */
export function requireBear(
  snapshot: FloeSnapshot,
  id: number,
  doing: string,
): BearSnapshot {
  const bear = bearById(snapshot, id);
  if (bear === undefined) {
    fail(
      `${doing} (bear ${id}) still on the strait`,
      `bears ${JSON.stringify(snapshot.bears.map((entry) => entry.id))}`,
    );
  }
  return bear;
}

/** The last bear of the roster, which is where an emerged one lands. */
export function lastBear(snapshot: FloeSnapshot): BearSnapshot | undefined {
  return snapshot.bears[snapshot.bears.length - 1];
}

/** The tile distance `specs/hunter.md` routes by: the sum of the two differences. */
export function tileDistance(a: Tile, b: Tile): number {
  return Math.abs(a.col - b.col) + Math.abs(a.row - b.row);
}

/** Stage units a second, from a distance covered over a count of ticks. */
export function speedOverTicks(covered: number, ticks: number): number {
  return covered / seconds(ticks);
}

/**
 * The strait after each of `ticks` ticks, one tick apart, with the state BEFORE
 * the first tick at index `0`.
 *
 * So `samples[k]` is the strait after `k` ticks, and `samples[k]` against
 * `samples[k - 1]` is what one tick did. The checks about the glide — the axis a
 * tick moved a bear along, where its centre was when it turned — are all readings
 * of that difference, and a tick is the finest grain the specification's fixed
 * timestep has, so this is as close as any of them can look.
 *
 * It goes through `until` with a predicate that never holds, rather than an
 * `advance`/`snapshot` pair, so the sweep is one loop in the harness rather than
 * one round trip per tick.
 */
export async function samplePerTick(
  h: Harness,
  ticks: number,
): Promise<FloeSnapshot[]> {
  const samples: FloeSnapshot[] = [];
  await h.until(
    (snapshot) => {
      samples.push(snapshot);
      return false;
    },
    { maxFrames: ticks, poll: 1 },
  );
  return samples;
}

/**
 * Drive a bear `ticks` ticks along one axis, committing it to another step in
 * `direction` on every tick it is settled, and hand back the distance its centre
 * covered.
 *
 * WHAT THIS MEASURES, AND WHY IT IS A RATE RATHER THAN A ROUTE. The bear the
 * speed checks measure is posed with its routing off (`poseBear`), so nothing but
 * this chooses where it goes: it travels the axis it was given, tile after tile,
 * and the distance it covers over a known count of ticks is its speed and nothing
 * else. `specs/hunter.md` puts the leftover travel at a tile centre onto the next
 * tick, so re-committing the step on the tick it settles loses none of it.
 *
 * The distance is summed tick by tick rather than taken end to end, so a bear
 * that turned back would not read as one that had stood still.
 */
export async function stepAcross(
  h: Harness,
  id: number,
  direction: Facing,
  ticks: number,
): Promise<number> {
  const doing = "the bear whose speed is being measured";
  let view = requireBear(h.snapshot(), id, doing);
  let covered = 0;
  for (let tick = 0; tick < ticks; tick += 1) {
    if (bearSettled(view)) h.debug.setBearStep(id, direction);
    await h.advance(1);
    const next = requireBear(h.snapshot(), id, doing);
    covered += Math.hypot(next.x - view.x, next.y - view.y);
    view = next;
  }
  return covered;
}

/**
 * The largest roster seen over `ticks` ticks, read every `poll` ticks.
 *
 * The reading the three slot-count checks take. It is a separate call rather than
 * one long sweep so a check can arm `captureReplay` around the opening stretch
 * alone — a minute of this game is seven thousand two hundred ticks, and a
 * recording of every one of them buys a reviewer nothing.
 *
 * IT RUNS AT THE HARNESS'S COARSE PACE. Both figures are in TICKS, which is what
 * the checks state them in, and the same ticks run either way: specs/overview.md
 * has the simulation advance by the whole `TICK_DT` ticks a frame's delta
 * completes, so a minute reaches the same strait however it was divided into
 * frames, and `instrumentation/tick-length` is the point that decides the tick.
 * What the pace changes is the number of PICTURES drawn between two readings, and
 * nothing here is read from a picture: the roster is read every `poll` ticks of
 * GAME time, whatever the pace. The clock is put back to one tick a frame in a
 * `finally`, so a check that continues afterwards steps tick by tick again.
 */
export async function largestRoster(
  h: Harness,
  ticks: number,
  poll: number,
): Promise<number> {
  let largest = 0;
  const frames = Math.ceil(ticks / COARSE_TICKS);
  const pollFrames = Math.max(1, Math.round(poll / COARSE_TICKS));
  h.pace(COARSE_TICKS);
  try {
    await h.until(
      (snapshot) => {
        largest = Math.max(largest, snapshot.bears.length);
        return false;
      },
      { maxFrames: frames, poll: pollFrames },
    );
  } finally {
    h.pace(1);
  }
  return largest;
}

/**
 * Whether a VEHICLE covers a tile right now — the reading `specs/hunter.md` closes
 * a tile to a bear by, and the reading `specs/ice.md` fixes.
 *
 * Vehicles only: a floe covers tiles too, but a floe closes nothing to a bear and
 * takes no bear off the strait. It makes the tile ice footing, which is
 * `swims-flag`'s and `floe-speed`'s business rather than this one's.
 */
export function vehicleCoversTile(
  snapshot: FloeSnapshot,
  col: number,
  row: number,
): boolean {
  return vehiclesOn(snapshot, row).some((item) =>
    itemCoversPoint(item, tileCX(col)),
  );
}

/**
 * Whether a tile is one a vehicle of its lane will cover within
 * `BEAR_AVOID_LEAD`, carrying the lane forward at its current speed and
 * direction — the second half of what `specs/hunter.md` calls an OPEN tile.
 *
 * The span each vehicle sweeps in that lead is its own span extended by the
 * distance its lane carries it, and the tile is swept when its centre falls in
 * that span. `margin` shrinks the span at both ends, in stage units: the caller
 * states how far a reading taken after a tick may honestly disagree with the
 * decision the build made during it, and nothing here decides that for it.
 */
export function imminentlyCovered(
  snapshot: FloeSnapshot,
  col: number,
  row: number,
  margin: number,
): boolean {
  const lane = laneAt(snapshot, row);
  if (lane === undefined) return false;
  const centre = tileCX(col);
  const travel = lane.dir * lane.speed * TILE * BEAR_AVOID_LEAD;
  return vehiclesOn(snapshot, row).some((item) => {
    const from = Math.min(item.x, item.x + travel) + margin;
    const to = Math.max(item.x, item.x + travel) + TILE * item.len - margin;
    return centre >= from && centre < to;
  });
}

/** Which grid axis a tick moved a centre along. */
export type Axis = "x" | "y" | "both" | "none";

/**
 * The axis a tick moved a centre along, reading anything under `epsilon` units as
 * no movement at all.
 *
 * `both` is the reading `specs/hunter.md` says no tick ever produces, and `none`
 * is a tick a bear spent settled; a caller that is looking for a TURN reads only
 * the ticks that came back `x` or `y`.
 */
export function axisMoved(
  from: { x: number; y: number },
  to: { x: number; y: number },
  epsilon: number,
): Axis {
  const dx = Math.abs(to.x - from.x) > epsilon;
  const dy = Math.abs(to.y - from.y) > epsilon;
  if (dx && dy) return "both";
  if (dx) return "x";
  if (dy) return "y";
  return "none";
}
