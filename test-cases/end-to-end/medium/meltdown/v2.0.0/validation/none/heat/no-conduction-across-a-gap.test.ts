// Meltdown — heat/no-conduction-across-a-gap: a gap conducts nothing.
//
// `specs/heat.md` puts conduction on the edge-tiles two towers ABUT along, and
// says so in the other direction too: "two emitters separated by a gap or
// touching only at a corner exchange nothing". A gap of a tile means every
// edge-tile of both towers faces open floor, so both are shedding to air alone,
// however hot the tower on the other side of the gap is.
//
// TWO ARCS AT `90` AND `10`, ONE TILE APART, so the flow a build wrongly reaches
// across the gap would be enormous next to what either tower is actually doing:
// the pair would exchange `3.5 * 2 * 80`, which is `560` per second, against the
// `16.92` the hot tower sheds to air and the `1.88` the cool one sheds. So a
// build that conducts across a gap does not merely read a little high — the cool
// tower reads a GAIN of hundreds where the specification requires a small loss.
//
// THE FIGURES. `specs/towers.md` gives the Arc a 2x2 footprint with radiator
// faces N and S, so with all four faces on open floor each tower has four
// radiator edge-tiles and four plain ones, and `specs/heat.md`'s air term makes
// that `(3.6 * 4 + 1.1 * 4) * (H / 100)` per second over a mass of `1.0`. That
// each of those figures is right on its own is `heat/air-cooling-rate`'s
// requirement; here they are the yardstick the absence of an exchange is read
// against.
//
// One frame, so no reading is taken at a heat an earlier frame had already moved.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo } from "../assert";
import { BASE_K, RAD_K, TRIP_HEAT } from "../constants";
import { freeSite } from "../fixtures";
import {
  captureStill,
  createHarness,
  poseIdleTower,
  requireTower,
  seconds,
  startRun,
  type Harness,
} from "../harness";
import { sizeOf } from "../thermal";

/** The pair, and the two heats they open at. */
const TOWER = "arc";
const HOT = 90;
const COOL = 10;

/** The gap between the two footprints, in tiles. */
const GAP = 1;

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
 * reading is one frame of a build's own arithmetic over figures the
 * specification states exactly. What the bound excludes is the wrong model this
 * item exists to name by a factor of thousands: an exchange across the gap moves
 * `560` per second.
 */
const RATE_DIGITS = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("A gap conducts nothing", async () => {
  await startRun(h);
  const site = freeSite(0);
  const hot = await poseIdleTower(h, TOWER, site.col, site.row, { heat: HOT });
  const cool = await poseIdleTower(
    h,
    TOWER,
    site.col,
    site.row + sizeOf(TOWER) + GAP,
    { heat: COOL },
  );

  await h.advance(1);
  await captureStill(h, "gap");
  const settled = await h.snapshot();

  assertCloseTo(
    (HOT - requireTower(settled, hot, "the hot Arc").heat) / DT,
    airRate(HOT),
    RATE_DIGITS,
    `heat per second the tower at ${HOT} loses with a ${GAP}-tile gap ` +
      `between it and a tower at ${COOL}`,
  );
  assertCloseTo(
    (COOL - requireTower(settled, cool, "the cool Arc").heat) / DT,
    airRate(COOL),
    RATE_DIGITS,
    `heat per second the tower at ${COOL} loses across that same gap`,
  );
});
