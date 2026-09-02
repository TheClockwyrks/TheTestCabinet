// Floe — ice/lane-wraps: a lane's spacing survives the edges of the strait.
//
// specs/ice.md: the even spacing "holds at every moment of play and at every
// level, across the strait's edges included: a vehicle carried off one edge
// returns at the other so the run of vehicle and gap continues unbroken, and a
// lane always carries enough vehicles to reach both edges of the strait."
//
// A lane laid out once and then simply translated satisfies `ice/lane-gaps`
// forever — the run of clear ice between two neighbours never changes when
// everything moves together. What it does NOT do is keep the strait covered:
// the pattern slides off one side and leaves clear ice behind it. So this check
// runs the band for ten seconds of game time and, at each second, reads BOTH
// halves of that sentence:
//
//   - THE RUNS. Every run of clear ice between consecutive vehicles is still the
//     lane's stated gap. This is what fails a build that re-enters a vehicle at
//     the wrong place: a wrap that lands a vehicle a fraction of a tile out
//     breaks exactly one run, and the run it breaks is named.
//   - THE REACH. The pattern still reaches both edges. Clear ice at the left
//     edge of the strait is part of the run before the leftmost vehicle, and an
//     unbroken run of vehicle and gap makes that run at most one gap wide: the
//     vehicle before it would otherwise still be on the strait and BE the
//     leftmost. The same at the right, for the rightmost vehicle's right edge. A
//     lane that never wrapped drifts until one of the two fails.
//
// Ten seconds is the item's own figure, and it is more than the slowest ice lane
// needs: at `1.5` tiles a second row 17 covers `480` units, well past the
// `352`-unit run of vehicle and gap it repeats, so every lane carries at least
// one vehicle across an edge inside the section.
//
// NOTHING IS POSED. The requirement is about the lanes a level lays down, so the
// level is laid out and left alone; the only thing driven is the clock.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual, assertLessThanOrEqual } from "../assert";
import { ICE_LANES, STRAIT_W, TILE, laneGap } from "../constants";
import {
  captureReplay,
  createHarness,
  ticksFor,
  type FloeSnapshot,
  type Harness,
} from "../harness";
import { clearIceRuns, layOutLevel, vehiclesAlong } from "./harness";

/** The level laid out: the table's gaps are its level-1 ones. */
const LEVEL = 1;

/** The game time the band is run for, in seconds. The item's own figure. */
const SECTION_SECONDS = 10;

/** How long a stretch of that section separates two readings, in seconds. */
const SAMPLE_SECONDS = 1;

/**
 * Ticks per frame while the section runs.
 *
 * The simulation advances by the whole `TICK_DT` ticks a frame's delta completes
 * and reaches the same state however an interval was divided into frames
 * (specs/overview.md), so four ticks a frame runs exactly the same section as one
 * tick a frame — and `instrumentation/deterministic-core` is the point that
 * decides it. Four rather than the harness's coarser `skip` pace so the whole
 * section still records at thirty frames a second, and nothing here is read off a
 * picture: every reading below is spaced in GAME time.
 */
const TICKS_PER_FRAME = 4;

/** Frames one stretch between two readings takes at that pace. */
const SAMPLE_FRAMES = ticksFor(SAMPLE_SECONDS) / TICKS_PER_FRAME;

/**
 * How far a run of clear ice may sit from the table's figure, in stage units.
 *
 * The tenth of a tile `ice/lane-gaps` allows, unchanged: a lane's gap is a WHOLE
 * number of tiles, so the nearest wrong spacing a build could be keeping is a
 * whole tile — `32` units — away, and this bound is a tenth of that. A wrap that
 * puts a vehicle back a tenth of a tile out is out by more than the rest of the
 * lane's ten seconds of travel ever drifts.
 */
const GAP_TOLERANCE = 0.1 * TILE;

/** Every reading taken of one lane at one moment of the section. */
interface LaneReading {
  /** The seconds of game time the section had run when it was taken. */
  at: number;
  row: number;
  /** How many vehicles the row carried. */
  count: number;
  /** The clear ice between consecutive vehicles, in stage units. */
  runs: number[];
  /** The leftmost vehicle's left edge. */
  leftEdge: number;
  /** The rightmost vehicle's right edge. */
  rightEdge: number;
}

/** Every ice lane read at one moment. */
function readBand(snapshot: FloeSnapshot, at: number): LaneReading[] {
  return ICE_LANES.map((lane) => {
    const ordered = vehiclesAlong(snapshot, lane.row);
    const last = ordered[ordered.length - 1];
    return {
      at,
      row: lane.row,
      count: ordered.length,
      runs: clearIceRuns(snapshot, lane.row),
      leftEdge: ordered.length === 0 ? Number.NaN : ordered[0].x,
      rightEdge: ordered.length === 0 ? Number.NaN : last.x + TILE * last.len,
    };
  });
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("keeps every ice lane's gaps and its reach across ten seconds of wrapping", async () => {
  const laid = await layOutLevel(h, LEVEL);

  const readings: LaneReading[] = readBand(laid, 0);
  h.pace(TICKS_PER_FRAME);
  try {
    await captureReplay(h, "wrap", async () => {
      for (
        let at = SAMPLE_SECONDS;
        at <= SECTION_SECONDS;
        at += SAMPLE_SECONDS
      ) {
        await h.advance(SAMPLE_FRAMES);
        readings.push(...readBand(h.snapshot(), at));
      }
    });
  } finally {
    // In a `finally`, so a section that failed still hands the clock back at one
    // tick a frame.
    h.pace(1);
  }

  for (const reading of readings) {
    const where = `row ${reading.row} at ${reading.at} s`;
    const gap = laneGap(reading.row, LEVEL) * TILE;

    assertGreaterThanOrEqual(
      reading.count,
      2,
      `${where}: vehicles enough to leave a run of clear ice between two of ` +
        `them (specs/ice.md)`,
    );
    for (const [index, run] of reading.runs.entries()) {
      assertLessThanOrEqual(
        Math.abs(run - gap),
        GAP_TOLERANCE,
        `${where}, between vehicles ${index} and ${index + 1}: the clear ice ` +
          `away from ${gap} units, was ${run}`,
      );
    }

    // The pattern still reaches both edges: the clear ice before the first
    // vehicle and after the last is at most one gap, which is the widest run of
    // clear ice an unbroken lane has anywhere.
    assertLessThanOrEqual(
      reading.leftEdge,
      gap + GAP_TOLERANCE,
      `${where}: clear ice at the left edge of the strait, as the leftmost ` +
        `vehicle's left edge, which one gap of ${gap} units bounds`,
    );
    assertGreaterThanOrEqual(
      reading.rightEdge,
      STRAIT_W - gap - GAP_TOLERANCE,
      `${where}: the rightmost vehicle's right edge, which is at most one gap ` +
        `of ${gap} units short of the strait's right edge at ${STRAIT_W}`,
    );
  }
});
