// presentation/heat-glow-ramp — an emitter's drawn colour tracks its heat.
//
// THE RULE. specs/overview.md's legibility table: "An emitter's drawn color
// tracks its heat along a ramp, and the cold end and the near-redline end read
// plainly apart." Two claims, and this check reads both: the ends of the ramp are
// plainly apart, and what lies between them is a RAMP rather than a switch.
//
// HOW THE FIVE HEATS ARE POSED. Five emitters of the same type, on the same row,
// at the five heats, in ONE frame. One frame rather than five because the picture
// this point leaves behind is the ramp itself, and because five towers of one
// type at one row are drawn by the same code with the same geometry, so the
// reading at each heat is point-for-point comparable with the reading at every
// other. Each holds both faculties (presentation/pose.ts), so no tower fires, no
// tower cools, and the heat each was posed at is the heat it is carrying on the
// frame that draws it. They stand two tiles apart, so none abuts another.
//
// WHAT IS COMPARED. specs/overview.md fixes no palette, so what an emitter looks
// like at any heat is the build's. Every reading here is therefore a comparison
// between two things the BUILD drew: the same footprint region at one heat
// against the same region at another. Nothing names a colour.
//
// WHY A PROPORTION OF THE FOOTPRINT AND NOT ITS AVERAGE. A build may carry the
// heat in the tower's whole body, or in a rim, or in a core; averaging the
// footprint would fail the second and third for being subtle rather than for
// being wrong. So the reading is the PROPORTION of the footprint that changed,
// which a body, a rim and a core all answer.
//
// WHAT IT DOES NOT DECIDE. Whether a tower reads apart from the FLOOR is
// `towers-read-apart-from-the-floor`; whether a tripped tower reads apart from an
// online one is `tripped-reads-apart`; and the heat read on the footprint, with
// its marker at the redline, is `hud.on-floor-heat-read`. The proportion below is
// set well above the share of a footprint a heat read occupies, so this point
// cannot be passed by the heat read alone.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual } from "../assert";
import { sizeOf } from "../geometry";
import {
  captureStill,
  createHarness,
  startRun,
  type Harness,
  type Rgb,
} from "../harness";
import type { TowerType } from "../surface";
import { poseStillTower } from "./pose";
import { footprintRegion, movedFraction, readRegion } from "./read";

/**
 * How far apart, out of the 441 the RGB cube spans, the cold end and the
 * near-redline end must read.
 *
 * The suite's figure for two things a player tells apart at a glance, which is
 * what "read plainly apart" asks for, and the same 50 every other point in this
 * group draws its line at. It is more than eleven per cent of the scale: a shade
 * no build reaches by leaving the colour where it was.
 */
const APART_MIN = 50;

/**
 * How far apart two of the five readings must sit to count as two readings
 * rather than one.
 *
 * Derived from `APART_MIN`. The ramp crosses the scale in four steps of 25 heat,
 * so a ramp whose ends sit exactly at the 50 the rule demands, and which spends
 * that 50 evenly, moves 12.5 at every step. 12 is just under that, so the
 * shallowest ramp the rule admits still reads as five readings, while a build
 * that draws one colour for a whole stretch of the scale does not.
 */
const RAMP_STEP_MIN = 12;

/**
 * The proportion of a footprint that must carry the change for the change to be
 * the TOWER's rather than a marking on it.
 *
 * A heat read is a marker drawn on a footprint (specs/hud.md), and a marker is a
 * small part of one — a bar, a pip, a rim of the footprint's own bottom edge. A
 * quarter of the whole footprint is far more than any such marker, so a build
 * that draws a heat read and leaves the tower itself one flat colour cannot
 * satisfy this point with the heat read. It is low enough that a build carrying
 * the ramp in a rim or a core rather than in the whole body still passes.
 */
const FOOTPRINT_MOVED_MIN = 0.25;

/** The five heats the point names, from cold to just under the trip. */
const RAMP_HEATS: readonly number[] = [0, 25, 50, 75, 99];

/**
 * The emitter the ramp is read on, and where each of the five stands.
 *
 * The Lance, because its 4x4 footprint is the largest in the roster and so gives
 * the reading the most of the build's own drawing to read. Every column run is
 * clear of the next by two tiles, and every one is clear of the vent and exhaust
 * runs specs/floor.md fixes.
 */
const RAMP_TYPE: TowerType = "lance";
const RAMP_ROW = 24;
const RAMP_COLS: readonly number[] = [3, 9, 15, 32, 38];

/** How far inside the footprint the reading starts, and how dense it is. */
const FOOTPRINT_INSET = 3;
const FOOTPRINT_STEP = 3;

/** The footprint of each of the five, read at the heat it was posed at. */
async function readRamp(h: Harness): Promise<Rgb[][]> {
  startRun(h);
  const size = sizeOf(RAMP_TYPE);
  RAMP_HEATS.forEach((heat, index) => {
    poseStillTower(h, RAMP_TYPE, RAMP_COLS[index], RAMP_ROW, 0, heat);
  });
  await h.advance(1);
  captureStill(h, "ramp");

  return RAMP_COLS.map((col) =>
    readRegion(
      h,
      footprintRegion(col, RAMP_ROW, size, FOOTPRINT_INSET),
      FOOTPRINT_STEP,
    ),
  );
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the cold end and the near-redline end plainly apart", async () => {
  const read = await readRamp(h);

  const cold = RAMP_HEATS[0];
  const hot = RAMP_HEATS[RAMP_HEATS.length - 1];
  assertGreaterThanOrEqual(
    movedFraction(read[0], read[read.length - 1], APART_MIN),
    FOOTPRINT_MOVED_MIN,
    `a ${RAMP_TYPE} at heat ${cold} against the same tower at heat ${hot}: ` +
      `the proportion of its footprint drawn at least ${APART_MIN} of 441 ` +
      `apart between the two (specs/overview.md: the cold end and the ` +
      `near-redline end read plainly apart)`,
  );
});

it("draws a different colour at every step of the ramp", async () => {
  const read = await readRamp(h);

  for (let i = 0; i < RAMP_HEATS.length; i += 1) {
    for (let j = i + 1; j < RAMP_HEATS.length; j += 1) {
      assertGreaterThanOrEqual(
        movedFraction(read[i], read[j], RAMP_STEP_MIN),
        FOOTPRINT_MOVED_MIN,
        `a ${RAMP_TYPE} at heat ${RAMP_HEATS[i]} against the same tower at ` +
          `heat ${RAMP_HEATS[j]}: the proportion of its footprint drawn at ` +
          `least ${RAMP_STEP_MIN} of 441 apart between the two ` +
          `(specs/overview.md: an emitter's drawn colour tracks its heat along ` +
          `a ramp, so the five heats are five readings and not two)`,
      );
    }
  }
});
