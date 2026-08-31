// water/floe-carries — a floe carries its rider at the lane's own rate and the
// lane's own way.
//
// specs/water.md: "A critter whose footing is `floe` is carried by the lane it
// is on. Its center `x` changes by `d * s * TILE` units per second, `d` and `s`
// being that lane's direction and speed." It is the same arithmetic the lane
// moves its floes by, applied to the body standing on one, and it is what makes
// the water band a crossing rather than a set of stepping stones.
//
// THE LANE'S MOTION IS POSED, AND POSED AWAY FROM ITS TABLE ROW. `setLaneSpeed`
// and `setLaneDirection` each set one field and leave every item where it stands
// (specs/instrumentation.md), and the rule above is written of "that lane's
// direction and speed" rather than of the table's, so the lane is set drifting
// RIGHT at `2.5` tiles a second on row 6, which the table gives LEFTWARD at
// `3.2`. Every wrong model then reads as a different number over the second
// measured:
//
//   - carrying at the lane's posed motion — the rule — reads `+80` units;
//   - carrying at the row's TABLE motion, which a build that looked the row up
//     instead of reading its lane would do, reads `-102.4`;
//   - carrying at the posed speed but the table's direction reads `-80`;
//   - carrying at the table's speed but the posed direction reads `+102.4`;
//   - not carrying the rider at all reads `0`.
//
// The bound below is `1.6` units, and the nearest of those is `80` units from
// the rule's figure, so the reading separates the rule from every one of them
// fifty times over. `water/lane-speeds` and `water/lane-directions` are the
// items that grade the table itself; nothing here rests on it.
//
// THE RIDER STAYS ON ITS RAFT. The critter is posed at the centre of a four-tile
// raft, so the second of drift moves the two together and the footing under the
// reading is the same floe at the end as at the start. The raft is mid-strait
// and `2.5` tiles a second is `80` units, so neither reaches an edge inside the
// measurement and no wrap lands in it.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertLessThanOrEqual,
  assertTrue,
} from "../assert";
import { START_LIVES, TILE, tileCX, type LaneDir } from "../constants";
import {
  captureReplay,
  covers,
  createHarness,
  lastFloe,
  poseLane,
  startCrossing,
  ticksFor,
  type Harness,
} from "../harness";

/** The level the crossing is posed at. The carry rule is the same at each. */
const LEVEL = 1;

/** The water lane the critter rides. Mid-band, clear of both shores. */
const LANE_ROW = 6;

/** The kind it rides: a raft4, which the lane table gives row 6. */
const LANE_KIND = "raft4";

/** The column the critter starts on, and the raft's leftmost column. */
const CRITTER_COL = 20;
const FLOE_COL = CRITTER_COL - 1;

/** The lane's posed motion — deliberately neither of row 6's table figures. */
const LANE_DIR: LaneDir = 1;
const LANE_SPEED = 2.5;

/** The game time the carry is measured over, in seconds. The item's own figure. */
const MEASURED_SECONDS = 1;

/** What the rule gives for that second: `d * s * TILE`, in stage units. */
const EXPECTED_CARRY = LANE_DIR * LANE_SPEED * TILE * MEASURED_SECONDS;

/**
 * How far the carry may sit from that figure, as a fraction.
 *
 * The two per cent the item is stated at: `1.6` units out of `80`. The nearest
 * wrong model in the header is `80` units away, so the bound separates the rule
 * from every one of them fifty times over.
 */
const CARRY_TOLERANCE_FRACTION = 0.02;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("moves a rider's centre by the lane's own d * s * TILE over a second", async () => {
  const { debug } = harness;
  await startCrossing(harness, LEVEL);
  await poseLane(harness, LANE_ROW, LANE_KIND, [FLOE_COL]);
  await debug.setCritterTile(CRITTER_COL, LANE_ROW);
  await debug.setLaneDirection(LANE_ROW, LANE_DIR);

  // The scenario this check needs: the critter riding the parked raft, with the
  // lane still held at rest so the measurement starts where the pose left it.
  const posed = await harness.snapshot();
  const floe = lastFloe(posed);
  assertTrue(
    floe !== undefined && covers(floe, posed.critter.x),
    `a ${LANE_KIND} on row ${LANE_ROW} covering the critter's centre at ` +
      `x ${tileCX(CRITTER_COL)} (specs/water.md), was ${JSON.stringify(floe)}`,
  );
  assertEqual(
    posed.critter.footing,
    "floe",
    `the footing the carry rule applies to (specs/water.md)`,
  );
  const startX = posed.critter.x;

  // Released, and driven for the second the carry is measured over.
  const carried = await captureReplay(harness, "carry", async () => {
    await debug.setLaneSpeed(LANE_ROW, LANE_SPEED);
    await harness.advance(ticksFor(MEASURED_SECONDS));
    return harness.snapshot();
  });

  assertEqual(
    carried.lives,
    START_LIVES,
    `the lives left after ${MEASURED_SECONDS} s of being carried, which costs ` +
      `none (specs/water.md) — a rider swept off its floe measures nothing`,
  );
  assertLessThanOrEqual(
    Math.abs(carried.critter.x - startX - EXPECTED_CARRY),
    CARRY_TOLERANCE_FRACTION * Math.abs(EXPECTED_CARRY),
    `the centre x moved over ${MEASURED_SECONDS} s on a lane at dir ` +
      `${LANE_DIR} and ${LANE_SPEED} tiles a second, away from ` +
      `${EXPECTED_CARRY} units, was ${carried.critter.x - startX}`,
  );

  // Nothing the page threw or logged as an error while this harness drove it.
  assertDeepEqual(harness.pageErrors, []);
});
