// Floe (the hunter) — the readings only this group takes. CASE-PROVIDED.
//
// `validation/harness.ts` is shared by thirteen groups, so it carries what any of
// them could want: the browser reach, the clocks, the poses, the roster lookups.
// What is here is the handful of readings the HUNTER's checks take and no other
// group does — a per-tick sample of the strait, a bear driven step after step
// along one axis, and the two questions `specs/hunter.md` asks about a tile.
//
// NOTHING HERE HOLDS A TOLERANCE. Every figure below is the specification's own,
// read out of `../constants`; the slack a check allows around a reading is that
// check's own business and is stated in the check, beside the figure it is slack
// on. `imminentlyCovered` therefore takes its margin as an argument rather than
// choosing one.
//
// AND NOTHING HERE ASSERTS A VERDICT, except where a reading cannot be taken at
// all: a bear that has left the roster is named by `requireBear`, so a check that
// wanted to measure one fails with the bear it wanted rather than with a
// `TypeError`.

import { BEAR_AVOID_LEAD, TILE, tileCX, type Facing } from "../constants";
import {
  bearSettled,
  covers,
  laneAt,
  requireBear,
  type FloeSnapshot,
  type Harness,
} from "../harness";

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
 * It is ONE crossing into the page for the whole sample, through
 * `Harness.sample`: the ticks and the readings are exactly the ones a loop here
 * would have driven, and asking for them together takes the cost of a round trip
 * — which is a property of how busy the machine is rather than of the build —
 * out of a four-hundred-and-eighty-tick sweep.
 */
export async function samplePerTick(
  h: Harness,
  ticks: number,
): Promise<FloeSnapshot[]> {
  return [await h.snapshot(), ...(await h.sample(ticks))];
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
  let view = requireBear(await h.snapshot(), id, doing);
  let covered = 0;
  // `sampleWith` runs the pose, the tick and the reading in ONE crossing into the
  // page where this loop used to spend three, and the pose is still decided here:
  // the step is re-committed on exactly the ticks the bear is settled on.
  const series = await h.sampleWith(ticks, (snapshot) =>
    bearSettled(requireBear(snapshot, id, doing))
      ? { op: "setBearStep", args: [id, direction] }
      : null,
  );
  for (const snapshot of series) {
    const next = requireBear(snapshot, id, doing);
    covered += Math.hypot(next.x - view.x, next.y - view.y);
    view = next;
  }
  return covered;
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
  return snapshot.vehicles.some(
    (item) => item.row === row && covers(item, tileCX(col)),
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
  return snapshot.vehicles.some((item) => {
    if (item.row !== row) return false;
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
