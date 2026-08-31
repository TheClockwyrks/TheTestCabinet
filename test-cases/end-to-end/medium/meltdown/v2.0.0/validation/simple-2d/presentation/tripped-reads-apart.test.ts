// presentation/tripped-reads-apart — an offline tower is unmistakable.
//
// THE RULE. specs/overview.md's legibility table: "A tripped tower is
// unmistakable and reads apart from an online tower at the same heat."
// specs/heat.md is what makes the qualification load-bearing: a tripped emitter
// "fires nothing and acquires no target for the whole of its cooldown" and takes
// part in no term of the frame's resolution, so it is doing nothing at all for
// five seconds while the surge walks past it. A player looking at a floor of hot
// towers has to pick it out — and if a build says "tripped" only by drawing the
// tower hotter, there is nothing to pick out, because an online tower reaches the
// same heat on its way there.
//
// AT THE SAME HEAT, WHICH IS WHY THE PAIR IS POSED THIS WAY. The two readings are
// the SAME TYPE on the SAME TILE at the SAME heat on two consecutive frames, one
// tripped and one not. So the heat cannot account for the difference, the tile
// cannot, and the type cannot: the only thing that changed is the state the point
// is about. A build that draws its trip as a point on the heat ramp reads zero,
// and that is the wrong model this arrangement is posed to name.
//
// The heat is held where the pose put it. The trip is a CROSSING, not a value
// (specs/heat.md), so the tripped tower is posed rather than manufactured; and a
// real tripped tower would be bleeding to `0` at 20 a second, so both towers hold
// the thermal faculty (presentation/pose.ts) and both are still carrying the same
// heat on the frame that draws them.
//
// WHAT IS COMPARED, AND WHY IT IS NEVER A COLOUR. specs/overview.md fixes no
// palette, and in particular it does not say a tripped tower is red. The reading
// is what the footprint mostly is on one frame against what it mostly is on the
// other — the mean of its largest cluster of pixels either way
// (presentation/read.ts) — so a build that marks the trip with a body colour, a
// wash, a dark-out or a bold overlay all answer.
//
// WHAT IT DOES NOT DECIDE. That the tower actually goes offline, bleeds its heat
// and comes back after `TRIP_TIME` are the `trip` group's; that the trip plays a
// cue is `audio.trip-cue`; that the colour tracks the heat while ONLINE is
// `heat-glow-ramp`.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual } from "../assert";
import { sizeOf } from "../geometry";
import {
  captureStill,
  colorDistance,
  createHarness,
  startRun,
  type Harness,
  type Rgb,
} from "../harness";
import type { TowerType } from "../surface";
import { poseStillTower, poseStillTrippedTower } from "./pose";
import { dominant, footprintRegion, readRegion, showRgb } from "./read";

/**
 * How far, out of the 441 the RGB cube spans, the two must read.
 *
 * The suite's figure for two things a player tells apart at a glance, and the
 * same 50 every other point in this group draws its line at. "Unmistakable" is
 * the legibility table's own word for this one, so 50 is the floor rather than
 * the target.
 */
const APART_MIN = 50;

/**
 * How close two pixels of a footprint must be to count as the same reading, when
 * the check asks what the footprint mostly is.
 *
 * Half of `APART_MIN`, and the suite's figure for two readings that are the same
 * thing rather than two things: a body shaded across its own area, a gradient, a
 * pixel softened where it meets an outline.
 */
const SAME_READING_MAX = 25;

/**
 * The tower the pair is read on, where it stands, and the heat both carry.
 *
 * The Lance, because its 4x4 footprint is the largest in the roster. The heat is
 * in the middle of the band where the two states are genuinely confusable: high
 * enough that an online tower is well up its own ramp, and below the `100` at
 * which the trip happens, so neither reading is at an end of the scale.
 */
const TYPE: TowerType = "lance";
const COL = 8;
const ROW = 22;
const HEAT = 60;

/** How far inside the footprint the reading starts, and how dense it is. */
const FOOTPRINT_INSET = 3;
const FOOTPRINT_STEP = 3;

/** What the footprint mostly reads as on the frame now on the canvas. */
function readFootprint(h: Harness): Rgb {
  return dominant(
    readRegion(
      h,
      footprintRegion(COL, ROW, sizeOf(TYPE), FOOTPRINT_INSET),
      FOOTPRINT_STEP,
    ),
    SAME_READING_MAX,
  );
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws a tripped tower apart from an online one at the same heat", async () => {
  startRun(h);
  poseStillTower(h, TYPE, COL, ROW, 0, HEAT);
  await h.advance(1);
  captureStill(h, "online");
  const online = readFootprint(h);

  // The same type on the same tile at the same heat, offline this time.
  startRun(h);
  poseStillTrippedTower(h, TYPE, COL, ROW, HEAT);
  await h.advance(1);
  captureStill(h, "tripped");
  const tripped = readFootprint(h);

  assertGreaterThanOrEqual(
    colorDistance(online, tripped),
    APART_MIN,
    `an online ${TYPE} at heat ${HEAT} (${showRgb(online)}) against a tripped ` +
      `${TYPE} at the same heat on the same tile (${showRgb(tripped)}), out ` +
      `of 441 (specs/overview.md: a tripped tower is unmistakable and reads ` +
      `apart from an online tower at the same heat)`,
  );
});
