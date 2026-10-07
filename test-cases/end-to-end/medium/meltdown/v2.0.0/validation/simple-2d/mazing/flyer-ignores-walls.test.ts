// mazing/flyer-ignores-walls — a wall across a flyer's line turns it neither aside
// nor late.
//
// specs/mazing.md: a flyer "passes over every tower and every wall, and neither its
// line nor the time it takes to cross changes when the floor does."
//
// THE SHAPE OF THE CHECK IS A CONTRAST, because a claim that something did not
// change can only be read against the same flight with the thing removed. So the
// same flyer is put down on the same point twice — once over an empty floor, once
// with a wall across its line — and the two flights are compared sample for sample
// and frame for frame:
//
//   - THE LINE. Sample `k` of the walled flight against sample `k` of the open one.
//     Both are taken after exactly the same number of frames of the same clock, so
//     a flyer that ignores the wall matches itself to the last bits of a double,
//     and one that was turned aside separates immediately.
//   - THE TIME. The frame each flight left the floor on. specs/mazing.md says the
//     time to cross does not change, and this is that time.
//
// Nothing here asserts what the line IS or how fast the flight goes; that is
// `mazing/flyer-flies-straight`. This point decides only that the floor makes no
// difference to either.
//
// THE WALL. Seventeen 2x2 Arcs down columns 30..31, covering every row from 2 to 35
// — two columns thick, so there is no diagonal to squeeze through, and it crosses
// the flight line at row 23. Rows 0..1 are deliberately LEFT OPEN: with them
// covered too the left vent would have no route at all, and this check has no
// business posing a sealed floor when what it needs is a wall across one line. A
// walker meeting this wall goes the long way round; the flyer, by the sentence
// above, does not notice it.
//
// THE GUNS ARE OFF ACROSS THE WALL, and that is load-bearing rather than tidy:
// seventeen Arcs would put a Drift's `60` hp down in a fraction of a second, and a
// flight that ended in a kill is a flight that measured nothing.
// specs/instrumentation.md's firing gate holds targeting and the shot and leaves the
// tower walling exactly as specs/mazing.md says a tower of any kind does.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThanOrEqual } from "../assert";
import { ROWS, tileCX, tileCY } from "../constants";
import { sizeOf } from "../geometry";
import {
  TICK_HZ,
  captureStill,
  createHarness,
  hasUnit,
  poseWalker,
  startRun,
  ticksFor,
  unitOf,
  type Harness,
  type Point,
  type TowerType,
} from "../harness";
import { distance, poseWall, stackedWall } from "./geometry";

/** Where both flights start: the same tile, posed the same way in both legs. */
const START: Point = { x: tileCX(20), y: tileCY(26) };

/** The type the wall is built of: the 2x2 Arc. */
const WALL_TYPE: TowerType = "arc";

/** The column band the wall runs down: two tiles thick, crossing the line. */
const WALL_COL = 30;

/**
 * Every row an Arc of the wall is anchored on: rows 2 through 35.
 *
 * Rows 0..1 are left open so the left vent keeps a route and the floor is a wall
 * across a line rather than a sealed floor.
 */
const WALL_ROWS = Array.from(
  { length: ROWS / sizeOf(WALL_TYPE) - 1 },
  (_, index) => (index + 1) * sizeOf(WALL_TYPE),
);

const WALL = stackedWall(WALL_TYPE, WALL_COL, WALL_ROWS);

/** Frames between two samples of a flight: `5.33` logical units of travel. */
const POLL_FRAMES = 8;

/**
 * How long a flight may run before the check gives up on it, in frames.
 *
 * The line from the start point to the right exhaust is `574` logical units, which
 * the Drift's own `80` units per second cover in a little over seven seconds
 * (specs/surge.md). Twenty seconds is nearly three times that and still bounds a
 * flight that never arrives.
 */
const CAP_FRAMES = ticksFor(20);

/**
 * How far a walled sample may sit from the open sample taken at the same frame, in
 * logical units.
 *
 * Both flights are the same arithmetic over the same deltas, so a flyer that
 * ignores the floor matches itself exactly. The bound is set by what has to stay
 * separated: a flyer turned aside by a wall two columns wide leaves the line by
 * tiles, `19` units each (specs/floor.md), so a twentieth of one tile keeps the two
 * apart.
 */
const MAX_PATH_DIFF = 1.0;

/**
 * How far the walled crossing time may sit from the open one, in frames.
 *
 * The departure is only known to the poll it was noticed on, so two flights that
 * left on the very same frame can still be read `8` frames apart. The bound is two
 * polls, `0.13` s against a crossing of over seven seconds; a flight sent the long
 * way round a wall `19` columns from its exhaust would be seconds late.
 */
const MAX_FRAME_DIFF = 2 * POLL_FRAMES;

/** One flight: where it was at each poll, and the frame it was gone by. */
interface Flight {
  path: Point[];
  frames: number;
  left: boolean;
}

/**
 * Put a Drift down on the start point and sample it until it is gone.
 *
 * `atSample` runs at every poll, which is how the walled leg keeps its picture at
 * the moment the flyer is over the wall.
 */
async function fly(
  h: Harness,
  atSample?: (at: Point) => void,
): Promise<Flight> {
  const drift = poseWalker(h, "drift", "left");
  h.debug.setUnitPosition(drift, START.x, START.y);

  const path: Point[] = [];
  let frames = 0;
  let left = false;
  while (frames < CAP_FRAMES) {
    const snapshot = h.snapshot();
    if (!hasUnit(snapshot, drift)) {
      left = true;
      break;
    }
    const seen = unitOf(snapshot, drift);
    const at = { x: seen.x, y: seen.y };
    path.push(at);
    atSample?.(at);
    await h.advance(POLL_FRAMES);
    frames += POLL_FRAMES;
  }
  return { path, frames, left };
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("flies a Drift the same line in the same time with a wall across it", async () => {
  // The open floor first: the flight the walled one is compared against.
  startRun(h);
  const open = await fly(h);

  // The same flight with a wall across it. `startRun` clears both rosters, so the
  // only difference between the two legs is the wall.
  startRun(h);
  poseWall(h, WALL);
  let pictured = false;
  const walled = await fly(h, (at) => {
    if (pictured || at.x < tileCX(WALL_COL)) return;
    pictured = true;
    captureStill(h, "flight");
  });

  assertEqual(
    open.left,
    true,
    `the Drift crosses the open floor within ${CAP_FRAMES} frames; whether it ` +
      `had left after ${open.frames} was`,
  );
  assertEqual(
    walled.left,
    true,
    `the Drift crosses the walled floor within ${CAP_FRAMES} frames; whether ` +
      `it had left after ${walled.frames} was`,
  );

  const shared = Math.min(open.path.length, walled.path.length);
  for (let index = 0; index < shared; index += 1) {
    const t = ((index * POLL_FRAMES) / TICK_HZ).toFixed(2);
    assertLessThanOrEqual(
      distance(open.path[index], walled.path[index]),
      MAX_PATH_DIFF,
      `at t=${t} s the walled flight is where the open one was, ` +
        `(${open.path[index].x.toFixed(2)}, ` +
        `${open.path[index].y.toFixed(2)}); with the wall up it was at ` +
        `(${walled.path[index].x.toFixed(2)}, ` +
        `${walled.path[index].y.toFixed(2)}), away by`,
    );
  }

  assertLessThanOrEqual(
    Math.abs(walled.frames - open.frames),
    MAX_FRAME_DIFF,
    `the walled crossing takes the ${open.frames} frames the open one took, ` +
      `to the ${POLL_FRAMES}-frame poll the departure is read at; it took ` +
      `${walled.frames}, off by`,
  );
});
