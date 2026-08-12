// Automated validation for the Flyers sub-item `straight-line`.
//
// A Drift flyer flies a straight line from its vent to the opposite exhaust, over
// every tower and wall (specs/surge.md, specs/playfield.md). We wall the ground lane,
// spawn a real Drift, sample its position across the crossing, and confirm the samples
// lie on a straight line inside the lane between its vent and its exhaust — ignoring
// the maze entirely.
//
// WHY THIS DOES NOT ASSERT A CONSTANT `y`.
//
// It used to compare the Drift's `y` at the far side against its `y` at the vent, and
// that is a stronger claim than either spec makes. What is pinned is a straight line
// "from their vent to that vent's opposite exhaust" (specs/playfield.md) — and both of
// those are OPENINGS, not points: the left vent is four tile-rows (16..19) and so is
// the right exhaust. A build that enters on row 19 and aims at row 18 flies a perfectly
// straight line the whole way and finishes 19 px off its entry row, which the old
// assertion read as a bend. Constant `y` is one conformant choice among several;
// holding a STRAIGHT line is the requirement.
//
// So straightness is measured directly instead, as the largest distance any sample
// falls from the chord through the first and last of them. That is invariant to the
// line's slope, so it says nothing about which row a build picks at either end, and it
// still fails what the item is about: a flyer that curves, steps, or detours around the
// wall leaves the chord and is caught, whatever rows it started and finished on.
//
// The band check is what carries "over the maze". Both openings span rows 16..19, so a
// straight line between them stays inside those rows the whole way, and the wall below
// sits across rows 14..21 at columns 25..26, which contains that band. A Drift that
// holds the band while crossing from one side of those columns to the other has flown
// over the wall; a ground unit's detour around it cannot satisfy both at once.

import {
  newGame,
  build,
  spawn,
  unit,
  actTail,
  FLOOR_X0,
  FLOOR_Y0,
  TILE,
  LEFT_VENT_ROWS,
} from "../_helpers.mjs";

// Where the filmed part of the flight begins: a couple of tiles short of the Sink
// wall at column 25, so the clip opens with the wall ahead of the Drift and carries it
// over and past.
const WALL_APPROACH_X = FLOOR_X0 + 23 * TILE;

// The wall the flyer must cross: 2x2 Sinks at column 25, so columns 25..26.
const WALL_COL = 25;
const WALL_X0 = FLOOR_X0 + WALL_COL * TILE;
const WALL_X1 = FLOOR_X0 + (WALL_COL + 2) * TILE;

// The rows shared by the left vent and the right exhaust (specs/playfield.md), as the
// y band a straight flight between them has to stay inside.
const BAND_Y0 = FLOOR_Y0 + LEFT_VENT_ROWS[0] * TILE;
const BAND_Y1 =
  FLOOR_Y0 + (LEFT_VENT_ROWS[LEFT_VENT_ROWS.length - 1] + 1) * TILE;

// How far a sample may fall from the chord through the first and last of them, in
// logical pixels. Half a tile, which is loose on purpose: what this has to separate is
// a straight flight from a flight that went around, and going around the wall below
// means leaving it by at least its three-tile half-height — nearly six times this. So
// the margin can absorb whatever a build's own per-tick integration wanders by (both
// reference builds read under 0.1 px) without letting a detour through.
//
// Note this bounds CURVATURE, not slope. How steeply the line runs is set by which row
// of each four-row opening the build picks at either end, which is its choice to make;
// the band check below is what keeps that within the openings.
const STRAIGHTNESS_PX = TILE / 2;

/**
 * The largest perpendicular distance from any of `points` to the chord through the
 * first and last of them. 0 for a perfectly straight run, and it grows with any bend.
 *
 * Returns 0 for fewer than three points — a chord through two points contains them
 * both, so there is nothing to deviate — and the caller asserts separately that enough
 * samples were taken for the reading to mean anything.
 */
function chordDeviation(points) {
  if (points.length < 3) return 0;
  const a = points[0];
  const b = points[points.length - 1];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return 0;
  let worst = 0;
  for (const p of points) {
    // Twice the triangle's area over its base — the point's distance to the line.
    const d = Math.abs(dx * (p.y - a.y) - dy * (p.x - a.x)) / len;
    if (d > worst) worst = d;
  }
  return worst;
}

export default function item() {
  let driftId;
  let start;
  const samples = [];

  return {
    id: "flyers.straight-line",

    // Six one-second samples across the wall. See CLIP_HEADROOM_MS in _helpers.
    clipMs: 8000,

    // A wall across the ground lane — a flyer ignores it. Built from Sinks (movers
    // that never fire) so the wall proves the flyer flies over the maze without any
    // emitter shooting it out of the air along the way.
    //
    // What makes the line straight is that it stays straight ACROSS the wall, so the
    // filmed part has to contain the wall. The approach to it does not: the Drift's
    // run-up from the vent is a flyer over bare floor, which is the same picture on a
    // build that would have turned. So the run-up is skipped and the clip opens just
    // short of the Sinks. 1200 ticks = the old 20s cap, kept as the skip's ceiling.
    async arrange(api) {
      await newGame(api, "containment", "medium", 100000);
      await api.call("setLives", 100000);
      for (const row of [14, 16, 18, 20]) {
        await build(api, "sink", WALL_COL, row);
      }

      driftId = await spawn(api, "drift", "left");
      start = await unit(api, driftId);
      await api.skipUntil(
        (s) => s.surge.some((u) => u.id === driftId && u.x > WALL_APPROACH_X),
        { max: 1200, poll: 12 },
      );
    },

    // Sample the flight a second at a time as it crosses the wall and runs on to the
    // far side. At 80 px/s the ~510 px from the approach to the exhaust is a little
    // over six seconds, so six samples span the crossing without the Drift leaving the
    // floor under the sweep.
    async act(api) {
      for (let i = 0; i < 6; i += 1) {
        const u = await unit(api, driftId);
        if (!u) break;
        samples.push({ x: u.x, y: u.y });
        await actTail(api, 60); // 1 s between samples
      }
    },

    async assert(api, check) {
      check.expectEq("the unit is a flyer", start.flying, true);
      // The other half of "to that vent's opposite exhaust": a left-vent unit is
      // assigned the right exhaust and never the nearer one (specs/playfield.md), so a
      // flyer heading anywhere else is wrong however straight its line is.
      check.expectEq("bound for the opposite exhaust", start.exhaust, "right");
      // Hard: everything below reads the samples, and with too few of them the
      // straightness reading describes nothing.
      check.assertGe(
        "the flyer was tracked across the wall",
        samples.length,
        3,
      );
      check.expectLt(
        "the flight starts short of the wall's columns",
        samples[0].x,
        WALL_X0,
      );
      check.expectGt(
        "and comes out the far side of them",
        samples[samples.length - 1].x,
        WALL_X1,
      );
      check.expectLe(
        "the flyer holds a straight line",
        chordDeviation(samples),
        STRAIGHTNESS_PX,
      );
      // Over the maze, not around it: a straight line between two openings that both
      // span rows 16..19 stays inside those rows, and the wall spans them.
      check.expectOk(
        "the flight stays in the lane between its vent and its exhaust",
        samples.every((p) => p.y >= BAND_Y0 && p.y <= BAND_Y1),
      );
    },
  };
}
