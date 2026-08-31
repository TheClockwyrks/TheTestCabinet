// Meltdown — heat/no-conduction-at-a-corner: a corner conducts nothing.
//
// specs/heat.md defines `sharedEdges(T, U)` as "the number of edge-tiles along
// which towers `T` and `U` abut" and settles the corner case where it defines it:
// "two towers touching only at a corner share none". It repeats the consequence
// beside the flows: two emitters "touching only at a corner exchange nothing". A
// diagonal neighbour is therefore not a neighbour at all, and every edge-tile of
// both towers faces open floor.
//
// TWO ARCS AT `90` AND `10`, DIAGONALLY ADJACENT, their footprints meeting at one
// grid point and nowhere else. If the pair shared even one edge-tile the flow
// would be `3.5 * 1 * 80`, which is `280` per second, against the `16.92` the hot
// tower sheds to air and the `1.88` the cool one sheds — so a build that counts a
// corner as a contact does not read a little high; the cool tower reads a GAIN of
// hundreds where the specification requires a small loss.
//
// THE FIGURES. specs/towers.md gives the Arc a 2x2 footprint with radiator faces
// N and S, so with all four faces on open floor each tower has four radiator
// edge-tiles and four plain ones, and specs/heat.md's air term makes that
// `(3.6 * 4 + 1.1 * 4) * (H / 100)` per second over a mass of `1.0`. That those
// figures are right on their own is `heat/air-cooling-rate`'s requirement; here
// they are the yardstick the absence of an exchange is read against.
//
// The gap case is `heat/no-conduction-across-a-gap`: this one is the harder
// arrangement, where the two footprints do touch.

import { afterEach, beforeEach, it } from "vitest";
import { BASE_K, RAD_K, TRIP_HEAT } from "../../src/constants";
import { assertCloseTo } from "../assert";
import {
  captureStill,
  createHarness,
  poseIdleTower,
  seconds,
  sizeOf,
  startRun,
  type Harness,
} from "../harness";
import { towerOf } from "./roster";
import { freeSite } from "./sites";

/** The pair, and the two heats they open at. */
const TOWER = "arc";
const HOT = 90;
const COOL = 10;

/** The frame the reading is taken over, in seconds of game time. */
const DT = seconds(1);

/** The air term of a lone Arc with all four faces on open floor, per second. */
function airRate(heat: number): number {
  return (RAD_K * 4 + BASE_K * 4) * (heat / TRIP_HEAT);
}

/**
 * How close each measured rate must come, as decimal places of heat per second.
 *
 * One place is `0.05` of a heat point per second. The smaller of the two figures
 * is the cool tower's `1.88`, so the bound is under three percent of it, and the
 * reading is one frame of a build's own arithmetic over figures the specification
 * states exactly. What the bound excludes is the wrong model this item exists to
 * name by a factor of thousands: counting the corner as one shared edge-tile
 * moves `280` per second.
 */
const RATE_DIGITS = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("A corner conducts nothing", async () => {
  startRun(h);
  const site = freeSite(0);
  const step = sizeOf(TOWER);
  const hot = poseIdleTower(h, TOWER, site.col, site.row, 0, HOT);
  const cool = poseIdleTower(
    h,
    TOWER,
    site.col + step,
    site.row + step,
    0,
    COOL,
  );

  await h.advance(1);
  captureStill(h, "corner");
  const settled = h.snapshot();

  assertCloseTo(
    (HOT - towerOf(settled, hot).heat) / DT,
    airRate(HOT),
    RATE_DIGITS,
    `heat per second the tower at ${HOT} loses while touching a tower at ` +
      `${COOL} at one corner alone`,
  );
  assertCloseTo(
    (COOL - towerOf(settled, cool).heat) / DT,
    airRate(COOL),
    RATE_DIGITS,
    `heat per second the tower at ${COOL} loses at that same corner`,
  );
});
