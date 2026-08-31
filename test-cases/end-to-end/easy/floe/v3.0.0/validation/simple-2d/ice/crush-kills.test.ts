// ice/crush-kills — a vehicle whose own motion brings the critter's centre under
// it costs a life, on the tick it arrives.
//
// specs/ice.md: "The critter is crushed on any tick on which a vehicle in a lane
// whose speed is above `0` covers the critter's center. It loses a life", and
// covering is the span rule — the centre lies in `[itemX, itemX + TILE * len)`.
// specs/progression.md fixes what a life costs: `lives` drops by exactly one and
// `phase` becomes `dying`.
//
// THE SCENARIO POSES THE ARRIVAL EXACTLY, so that every wrong model of it reads
// as a different tick. A `car` is parked `112` units to the RIGHT of the
// critter's centre on a leftward lane held at `2.0` tiles a second — `64` units
// of stage a second — so its left edge reaches that centre after `112 / 64`
// seconds, which is `1.75` s and a whole `210` ticks. Against that:
//
//   - a build that crushes on OVERLAP of the two bodies rather than on the
//     centre being covered — the critter is a tile wide, so its left side meets
//     the car's right side `16` units earlier — reads about tick `180`;
//   - a build that crushes whenever a vehicle is anywhere on the critter's ROW
//     reads tick 1;
//   - a build that never crushes reads no tick at all.
//
// Each is tens of ticks from `210`, and the bound below is three.
//
// THE LANE'S MOTION IS POSED, both its speed and its direction, because neither
// is what this decides: `ice/lane-speeds` and `ice/lane-directions` grade the
// table. What is left for this check is the crush and the tick it lands on.
//
// THE STRAIT IS EMPTY BUT FOR THE TWO BODIES. `startCrossing` clears both
// rosters and shuts the four world gates, so the life this loses cannot have
// come from a bear, from open water, from the crossing timer or from anything
// else that costs one (specs/progression.md).

import { afterEach, beforeEach, it } from "vitest";
import {
  START_LIVES,
  TICK_HZ,
  TILE,
  tileCX,
  tileLeft,
} from "../../src/constants";
import { assertEqual, assertLessThanOrEqual, assertTrue } from "../assert";
import {
  captureReplay,
  coversX,
  createHarness,
  lastVehicle,
  poseLane,
  startCrossing,
  ticksFor,
  type Harness,
} from "../harness";

/** The level the crossing is posed at. The crush rule is the same at each. */
const LEVEL = 1;

/** The ice lane the two bodies are posed on. Mid-band, clear of both shores. */
const LANE_ROW = 15;

/** The column the critter stands on. Mid-strait, clear of both edges. */
const CRITTER_COL = 20;

/** The column the car is parked at before the lane is released. */
const CAR_COL = 24;

/** The lane's posed motion: leftward, at the table's level-1 figure for row 15. */
const LANE_DIR = -1;
const LANE_SPEED = 2.0;

/** How far the car's left edge starts from the critter's centre, in stage units. */
const APPROACH = tileLeft(CAR_COL) - tileCX(CRITTER_COL);

/** The tick the car's left edge reaches that centre: `APPROACH / (speed * TILE)`. */
const ARRIVAL_TICK = Math.round((APPROACH / (LANE_SPEED * TILE)) * TICK_HZ);

/**
 * How many ticks either side of the arrival the life may be taken on.
 *
 * A tick is `1/120` s and the approach is integrated over two hundred and ten of
 * them, so a build summing `speed * TILE * TICK_DT` lands a few parts in a
 * quadrillion either side of the boundary and may take the tick after; a build
 * that runs its hazards before its lanes rather than after takes one more. Three
 * covers both and stays an order of magnitude inside the nearest wrong model,
 * which is thirty ticks away.
 */
const ARRIVAL_TOLERANCE_TICKS = 3;

/** How far past the arrival the sweep looks before reporting no crush at all. */
const SWEEP_TICKS = ARRIVAL_TICK + ticksFor(1);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("costs a life on the tick a released vehicle's span reaches the critter's centre", async () => {
  startCrossing(h, LEVEL);
  h.debug.setCritterTile(CRITTER_COL, LANE_ROW);
  poseLane(h, LANE_ROW, "car", [CAR_COL]);
  h.debug.setLaneDirection(LANE_ROW, LANE_DIR);

  // The scenario this check needs: the critter on the lane with its full lives,
  // and the car clear of it on the side the lane runs from.
  const posed = h.snapshot();
  const car = lastVehicle(posed);
  assertEqual(
    posed.lives,
    START_LIVES,
    "the crossing begins with every life still in hand (specs/progression.md)",
  );
  assertTrue(
    !coversX(car, posed.critter.x),
    `a car parked at x ${tileLeft(CAR_COL)}, clear of the critter's centre at ` +
      `x ${tileCX(CRITTER_COL)} (specs/ice.md), was ${JSON.stringify(car)}`,
  );

  // Released, and swept a tick at a time so the tick the life goes is the tick
  // this reads.
  const crushed = await captureReplay(h, "crush", async () => {
    h.debug.setLaneSpeed(LANE_ROW, LANE_SPEED);
    return h.until((snapshot) => snapshot.lives < START_LIVES, {
      maxFrames: SWEEP_TICKS,
      poll: 1,
    });
  });

  assertTrue(
    crushed.hit,
    `a life lost within ${SWEEP_TICKS} ticks of the lane being released, as ` +
      `the car's span reaches the critter's centre at tick ${ARRIVAL_TICK} ` +
      `(specs/ice.md), was ${crushed.snapshot.lives} lives still in hand`,
  );
  assertLessThanOrEqual(
    Math.abs(crushed.frames - ARRIVAL_TICK),
    ARRIVAL_TOLERANCE_TICKS,
    "the tick the life was taken on, away from the tick the car's left edge " +
      `reaches the critter's centre (${ARRIVAL_TICK}), was ${crushed.frames}`,
  );
  assertEqual(
    crushed.snapshot.lives,
    START_LIVES - 1,
    "the lives left after being crushed (specs/progression.md)",
  );
  assertEqual(
    crushed.snapshot.phase,
    "dying",
    "the phase a lost life leaves the crossing in (specs/progression.md)",
  );
});
