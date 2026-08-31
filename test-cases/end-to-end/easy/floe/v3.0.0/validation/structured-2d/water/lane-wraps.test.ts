// Floe — water/lane-wraps: a lane's spacing survives the edges of the strait.
//
// specs/water.md: the even spacing "holds at every moment of play and at every
// level, across the strait's edges included: a floe carried off one edge returns
// at the other so the run of floe and open water continues unbroken, and a lane
// always carries enough floes to reach both edges of the strait."
//
// A lane laid out once and then simply translated satisfies `water/lane-gaps`
// forever — the run of open water between two neighbours never changes when
// everything moves together. What it does NOT do is keep the strait covered: the
// pattern drifts off one side and leaves open water behind it, which under
// specs/water.md is a row the critter cannot cross at all. So this check runs the
// band for ten seconds of game time and, at each second, reads BOTH halves of
// that sentence:
//
//   - THE RUNS. Every run of open water between consecutive floes is still the
//     lane's stated gap. This is what fails a build that re-enters a floe at the
//     wrong place: a wrap that lands a floe a fraction of a tile out breaks
//     exactly one run, and the run it breaks is named.
//   - THE REACH. The pattern still reaches both edges. Open water at the left
//     edge of the strait is part of the run before the leftmost floe, and an
//     unbroken run of floe and gap makes that run at most one gap wide: the floe
//     before it would otherwise still be on the strait and BE the leftmost. The
//     same at the right, for the rightmost floe's right edge. A lane that never
//     wrapped drifts until one of the two fails.
//
// Ten seconds is the item's own figure, and it is far more than the slowest
// water lane needs: at `3.0` tiles a second row 9 covers `960` units, well past
// the `224`-unit run of floe and gap it repeats, so every lane carries several
// floes across an edge inside the section.
//
// NOTHING IS POSED. The requirement is about the lanes a level lays down, so the
// level is laid out and left alone; the only thing driven is the clock.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual, assertLessThanOrEqual } from "../assert";
import { STRAIT_W, TILE, WATER_LANES, laneGap } from "../../src/constants";
import {
  captureReplay,
  createHarness,
  ticksFor,
  type FloeSnapshot,
  type Harness,
} from "../harness";
import { floesAlong, layOutLevel, openWaterRuns } from "./harness";

/** The level laid out: the table's gaps are its level-1 ones. */
const LEVEL = 1;

/** The game time the band is run for, in seconds. The item's own figure. */
const SECTION_SECONDS = 10;

/** How long a stretch of that section separates two readings, in seconds. */
const SAMPLE_SECONDS = 1;

/**
 * How far a run of open water may sit from the table's figure, in stage units.
 *
 * The tenth of a tile `water/lane-gaps` allows, unchanged: a lane's gap is a
 * WHOLE number of tiles, so the nearest wrong spacing a build could be keeping
 * is a whole tile — `32` units — away, and this bound is a tenth of that. A wrap
 * that puts a floe back a tenth of a tile out is out by more than the rest of
 * the lane's ten seconds of drift ever moves it relative to its neighbours.
 */
const GAP_TOLERANCE = 0.1 * TILE;

/** Every reading taken of one lane at one moment of the section. */
interface LaneReading {
  /** The seconds of game time the section had run when it was taken. */
  at: number;
  row: number;
  /** How many floes the row carried. */
  count: number;
  /** The open water between consecutive floes, in stage units. */
  runs: number[];
  /** The leftmost floe's left edge. */
  leftEdge: number;
  /** The rightmost floe's right edge. */
  rightEdge: number;
}

/** Every water lane read at one moment. */
function readBand(snapshot: FloeSnapshot, at: number): LaneReading[] {
  return WATER_LANES.map((lane) => {
    const ordered = floesAlong(snapshot, lane.row);
    const last = ordered[ordered.length - 1];
    return {
      at,
      row: lane.row,
      count: ordered.length,
      runs: openWaterRuns(snapshot, lane.row),
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

it("keeps every water lane's gaps and its reach across ten seconds of wrapping", async () => {
  const laid = await layOutLevel(h, LEVEL);

  const readings: LaneReading[] = readBand(laid, 0);
  await captureReplay(h, "wrap", async () => {
    for (let at = SAMPLE_SECONDS; at <= SECTION_SECONDS; at += SAMPLE_SECONDS) {
      await h.advance(ticksFor(SAMPLE_SECONDS));
      readings.push(...readBand(h.snapshot(), at));
    }
  });

  for (const reading of readings) {
    const where = `row ${reading.row} at ${reading.at} s`;
    const gap = laneGap(reading.row, LEVEL) * TILE;

    assertGreaterThanOrEqual(
      reading.count,
      2,
      `${where}: floes enough to leave a run of open water between two of ` +
        `them (specs/water.md)`,
    );
    for (const [index, run] of reading.runs.entries()) {
      assertLessThanOrEqual(
        Math.abs(run - gap),
        GAP_TOLERANCE,
        `${where}, between floes ${index} and ${index + 1}: the open water ` +
          `away from ${gap} units, was ${run}`,
      );
    }

    // The pattern still reaches both edges: the open water before the first floe
    // and after the last is at most one gap, which is the widest run of open
    // water an unbroken lane has anywhere.
    assertLessThanOrEqual(
      reading.leftEdge,
      gap + GAP_TOLERANCE,
      `${where}: open water at the left edge of the strait, as the leftmost ` +
        `floe's left edge, which one gap of ${gap} units bounds`,
    );
    assertGreaterThanOrEqual(
      reading.rightEdge,
      STRAIT_W - gap - GAP_TOLERANCE,
      `${where}: the rightmost floe's right edge, which is at most one gap of ` +
        `${gap} units short of the strait's right edge at ${STRAIT_W}`,
    );
  }
});
