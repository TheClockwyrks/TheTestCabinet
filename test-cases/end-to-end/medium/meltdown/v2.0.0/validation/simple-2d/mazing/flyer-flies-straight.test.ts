// mazing/flyer-flies-straight — a Drift travels the straight line to its exhaust,
// at its own speed, and measures its route off that line.
//
// specs/mazing.md: "A flying surge unit takes no route and no step. It travels in a
// straight line, at its own speed, from the point it entered at to the centre of
// its assigned exhaust's opening, which is the midpoint of that opening's run of
// tile centres." And: "A flyer's `remaining` is the straight-line distance from its
// centre to that same point, divided by `TILE`." specs/surge.md gives the Drift's
// own speed as `80` units per second.
//
// THREE READINGS, ONE RULE. The sentence quoted above names three things about one
// flight, and each is read here:
//
//   1. THE LINE. The flight is sampled every half second and every sample is held
//      to the line through the point the flyer started from and the aim point. The
//      aim point is computed from the specification's own words — the midpoint of
//      the run of tile centres, `(958.5, 360)` for the right exhaust
//      (`geometry.ts`'s `exhaustMidpoint`) — rather than from the nearest tile of
//      the run, which sits half a tile away.
//   2. ITS OWN SPEED. What the flyer covered over the window against
//      `80 * seconds`.
//   3. OFF THE TILE ROUTE. `remaining` against the straight-line distance in tiles,
//      which from the point posed here is `30.2200`, where the tile route a walker
//      would be given from the same tile is `31.8995`. The two are more than a tile
//      and a half apart, so a build that measures its flyers on the maze is named
//      by the figure it produced.
//
// WHERE THE FLIGHT STARTS. Tile (20, 26), put there through `setUnitPosition`,
// whose only stated effect on a unit is to place its centre and recompute its route
// from there (specs/instrumentation.md). That is a deliberate choice of point: a
// flyer entering at the left vent starts on one of rows 16..19, and the line from
// there to `(958.5, 360)` runs so nearly along a tile row that a build walking the
// tile route would stay within half a tile of it and pass a straightness check by
// accident. From (20, 26) the line climbs seven rows over twenty-nine columns and
// nothing that walks tiles can follow it.
//
// The four-second window covers `320` of the `574` units to the exhaust, so the
// flyer is still on the floor at the last sample and nothing here reads a
// departure. The floor is empty: what a wall does to a flight is
// `mazing/flyer-ignores-walls`.

import { afterEach, beforeEach, it } from "vitest";
import { assertLessThanOrEqual } from "../assert";
import { SURGE_DEFS, tileCX, tileCY } from "../constants";
import { exhaustMidpoint } from "../geometry";
import {
  TICK_HZ,
  captureReplay,
  createHarness,
  poseWalker,
  startRun,
  unitOf,
  type Harness,
  type Point,
} from "../harness";
import { flyerRemaining } from "../routes";
import { distance, offLine, remainingFromTile } from "./geometry";

/** Where the flight starts: seven rows below and twenty-nine columns west. */
const START_COL = 20;
const START_ROW = 26;

/** The point the flight starts from, and the point it aims at. */
const START: Point = { x: tileCX(START_COL), y: tileCY(START_ROW) };
const AIM: Point = exhaustMidpoint("right");

/** How long the flight is watched, and how often it is sampled. */
const WINDOW_SECONDS = 4;
const SAMPLE_FRAMES = 60;

/** The Drift's own speed, in logical units per second (specs/surge.md). */
const DRIFT_SPEED = SURGE_DEFS.drift.speed;

/**
 * How far off the line a sample may sit, in logical units.
 *
 * The line is exact arithmetic: a build that integrates a fixed heading and one
 * that re-aims from its current position every frame both stay on it to the last
 * bits of a double. The bound is set by what has to stay separated: a unit walking
 * between tile centres leaves the line by up to half a tile, `9.5` units
 * (specs/floor.md), so a tenth of that keeps a flight apart from a walk.
 */
const MAX_OFF_LINE = 1.0;

/**
 * How far the distance covered may sit from `80 * seconds`, in logical units.
 *
 * One frame of this suite's clock is `1 / 120` s, which at the Drift's own `80`
 * units per second is `0.667` units. The bound is three of those, which allows a
 * build that resolves the pose or the first frame a whisker differently and is
 * still under a hundredth of the `320` units the window buys.
 */
const MAX_SPEED_DRIFT = (3 * DRIFT_SPEED) / TICK_HZ;

/** The flyer's own route from the start point, in tiles: 30.2200. */
const STRAIGHT_TILES = flyerRemaining(START, "right");

/** What a build measuring its flyers on the maze would report: 31.8995 tiles. */
const WALKER_TILES = remainingFromTile([], "right", START_COL, START_ROW);

/**
 * How far the reported route may sit from the straight-line one, in tiles.
 *
 * Exact arithmetic on both sides, so the bound is set by what has to stay
 * separated: the two models above are `1.6795` tiles apart, and this is under an
 * eightieth of that.
 */
const TILES_TOLERANCE = 0.02;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("flies a Drift along the straight line to its exhaust at its own speed", async () => {
  startRun(h);
  const drift = poseWalker(h, "drift", "left");
  h.debug.setUnitPosition(drift, START.x, START.y);

  const posed = unitOf(h.snapshot(), drift);
  assertLessThanOrEqual(
    Math.abs(posed.remaining - STRAIGHT_TILES),
    TILES_TOLERANCE,
    `a flyer's remaining is the straight line to (${AIM.x}, ${AIM.y}) over a ` +
      `tile, ${STRAIGHT_TILES.toFixed(4)} tiles from ` +
      `(${START_COL}, ${START_ROW}); the tile route a walker would be given ` +
      `from there is ${WALKER_TILES.toFixed(4)}. The build reported ` +
      `${posed.remaining.toFixed(4)}, off the straight line by`,
  );

  const flight = await captureReplay(
    h,
    "flight",
    async (): Promise<Point[]> => {
      const path: Point[] = [];
      for (
        let frames = 0;
        frames < WINDOW_SECONDS * TICK_HZ;
        frames += SAMPLE_FRAMES
      ) {
        await h.advance(SAMPLE_FRAMES);
        const seen = unitOf(h.snapshot(), drift);
        path.push({ x: seen.x, y: seen.y });
      }
      return path;
    },
  );

  for (const [index, at] of flight.entries()) {
    const t = ((index + 1) * SAMPLE_FRAMES) / TICK_HZ;
    assertLessThanOrEqual(
      offLine(at, START, AIM),
      MAX_OFF_LINE,
      `at t=${t.toFixed(2)} s the flyer is on the line from ` +
        `(${START.x}, ${START.y}) to (${AIM.x}, ${AIM.y}); it was at ` +
        `(${at.x.toFixed(2)}, ${at.y.toFixed(2)}), off that line by`,
    );
  }

  const covered = distance(START, flight[flight.length - 1]);
  const expected = DRIFT_SPEED * WINDOW_SECONDS;
  assertLessThanOrEqual(
    Math.abs(covered - expected),
    MAX_SPEED_DRIFT,
    `over ${WINDOW_SECONDS} s a Drift covers ${expected} units at its own ` +
      `${DRIFT_SPEED} units per second (specs/surge.md); it covered ` +
      `${covered.toFixed(3)}, off by`,
  );
});
