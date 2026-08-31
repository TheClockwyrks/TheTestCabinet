// water/carry-crosses-tiles — the column a carried critter reports follows its
// centre across every tile boundary the drift takes it over.
//
// specs/water.md, of a critter whose footing is `floe`: "Its center `x` changes
// by `d * s * TILE` units per second ... and its column follows its center by
// `colAt(x)`. Its row and its center `y` are left where they are, and a floe
// carries the critter across tile boundaries without moving it between rows."
// specs/strait.md fixes the map that sentence names: `colAt(x) = floor(x / 32)`.
//
// THE RULE IS A RELATION, SO IT IS READ AS ONE. At every sample of the drive the
// reported `col` must be exactly `colAt` of the reported centre. That is the
// whole requirement, and it is what fails the build the item is really about:
// one that moves a rider's centre smoothly but leaves its `col` where the last
// HOP put it, so a critter carried four tiles still reports the tile it stepped
// onto. Such a build passes `water/floe-carries` — its centre moves at the right
// rate — and everything downstream of a column then reads the wrong tile: the
// bear's route, the covering that decides a crush, the bay a hop enters.
//
// THE SECOND HALF IS THAT THE COLUMN CHANGES ONE AT A TIME. The samples are
// `SAMPLE_TICKS` apart, which at the posed speed is `0.67` units of drift — a
// fiftieth of a tile — so consecutive samples cannot straddle two boundaries and
// every change in the reported column must be exactly one column, in the
// direction of the drift. A build that recomputed a column from something other
// than the centre — a rounded tile, the floe's own left edge — steps by two, or
// steps early, and is named by the sample it stepped at.
//
// THE DRIVE RUNS UNTIL THE CRITTER HAS BEEN CARRIED `CROSSED_TILES` TILES rather
// than for a fixed stretch of time, with a budget four times the game time the
// posed speed needs. That is deliberate: a fixed window would be demanding a
// carry RATE, which is `water/floe-carries`'s requirement and not this one, and
// a build that carries its rider slowly should fail there and pass here. What is
// genuinely a premise of this item — that the critter was "carried far enough"
// at all — is asserted as one.
//
// THE RIDER STAYS ON ITS RAFT. The critter is posed on the second tile of a
// four-tile raft mid-strait, so the raft and its rider drift together
// (specs/water.md), the footing under every reading is the same floe, and
// neither reaches a side edge inside the drive: five tiles of drift from column
// 17 leaves the critter twenty columns clear of the right edge, so nothing here
// is the sweep `water/off-edge-right` grades.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertGreaterThanOrEqual,
  assertTrue,
} from "../assert";
import {
  START_LIVES,
  TILE,
  colAt,
  tileCX,
  type Footing,
  type LaneDir,
} from "../constants";
import {
  captureReplay,
  covers,
  createHarness,
  lastFloe,
  poseLane,
  startCrossing,
  ticksFor,
  type FloeSnapshot,
  type Harness,
} from "../harness";

/** The level the crossing is posed at. The carry rule is the same at each. */
const LEVEL = 1;

/** The water lane the critter rides. Mid-band, clear of both shores. */
const LANE_ROW = 9;

/** The kind it rides: a raft4, which the lane table gives row 9. */
const LANE_KIND = "raft4";

/** The raft's leftmost column, and the column the critter is posed on. */
const FLOE_COL = 16;
const CRITTER_COL = 17;

/**
 * The lane's posed motion.
 *
 * The speed is this check's own — deliberately not row 9's table figure of `3.0`
 * — because nothing here reads a rate. The direction is the table's, so a build
 * that carried its rider by the row's table direction rather than by the lane's
 * still drifts the way this check drives it: which way a lane runs is
 * `water/lane-directions`'s requirement, and a failure there must not fail here
 * as well.
 */
const LANE_DIR: LaneDir = 1;
const LANE_SPEED = 2.5;

/** Which way the reported column must step, from the posed direction. */
const COLUMN_STEP = LANE_DIR;

/**
 * How many tile boundaries the drift must carry the critter over.
 *
 * Five, which is "far enough" with room to spare: a build that updated a column
 * only on some tick boundary of its own, or only every other tile, is caught by
 * a run of five rather than by a single crossing that a coincidence could
 * produce.
 */
const CROSSED_TILES = 5;

/** The centre displacement those crossings take, in stage units. */
const CROSSED_UNITS = CROSSED_TILES * TILE;

/**
 * The ticks between two samples.
 *
 * At the posed `2.5` tiles a second a tick carries the centre `0.67` units, so
 * two ticks carry it `1.33` — a twenty-fourth of a tile. Consecutive samples
 * therefore cannot straddle two boundaries at any carry rate up to twelve times
 * the one posed, which is what lets a change in the reported column be required
 * to be exactly one column.
 */
const SAMPLE_TICKS = 2;

/**
 * The game time the drive may take, in seconds.
 *
 * At the posed speed the five tiles take `2` s, so this is four times what the
 * rule needs. A budget rather than a window: see the header.
 */
const BUDGET_SECONDS = 8;

/** One reading of the carried critter. */
interface Sample {
  /** The ticks of the drive it was taken at. */
  at: number;
  x: number;
  col: number;
  footing: Footing;
}

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("keeps the carried critter's column at colAt of its centre across every boundary it crosses", async () => {
  const { debug } = harness;
  await startCrossing(harness, LEVEL);
  await poseLane(harness, LANE_ROW, LANE_KIND, [FLOE_COL]);
  await debug.setCritterTile(CRITTER_COL, LANE_ROW);
  await debug.setLaneDirection(LANE_ROW, LANE_DIR);

  // The scenario this check needs: the critter riding the parked raft, the lane
  // still at rest, and the column it was posed on reported back.
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
    "the footing the carry rule applies to (specs/water.md)",
  );
  const startX = posed.critter.x;

  // Released, and sampled every `SAMPLE_TICKS` until the drift has carried the
  // centre `CROSSED_TILES` tiles or the budget runs out.
  const samples: Sample[] = [];
  const take = (snapshot: FloeSnapshot, at: number): Sample => {
    const sample: Sample = {
      at,
      x: snapshot.critter.x,
      col: snapshot.critter.col,
      footing: snapshot.critter.footing,
    };
    samples.push(sample);
    return sample;
  };

  await captureReplay(harness, "carry", async () => {
    await debug.setLaneSpeed(LANE_ROW, LANE_SPEED);
    take(await harness.snapshot(), 0);
    const budget = ticksFor(BUDGET_SECONDS);
    for (let at = SAMPLE_TICKS; at <= budget; at += SAMPLE_TICKS) {
      await harness.advance(SAMPLE_TICKS);
      const sample = take(await harness.snapshot(), at);
      if (Math.abs(sample.x - startX) >= CROSSED_UNITS) break;
    }
  });

  const last = samples[samples.length - 1];

  // The ride cost nothing, so every reading above is of a critter still on its
  // floe rather than of one that drowned or was swept off part way through.
  assertEqual(
    last.footing,
    "floe",
    `the footing at the end of the drive, on the raft the critter was posed on`,
  );
  assertEqual(
    (await harness.snapshot()).lives,
    START_LIVES,
    "the lives left after being carried, which costs none (specs/water.md)",
  );

  // The premise: the drift really did carry it over that many boundaries.
  assertGreaterThanOrEqual(
    Math.abs(last.x - startX),
    CROSSED_UNITS,
    `the centre carried over ${CROSSED_TILES} tiles inside ` +
      `${BUDGET_SECONDS} s of a lane at ${LANE_SPEED} tiles a second ` +
      `(specs/water.md) — how fast a floe carries its rider is ` +
      `water/floe-carries`,
  );

  // The requirement: the column is `colAt` of the centre, at every reading.
  for (const sample of samples) {
    assertEqual(
      sample.col,
      colAt(sample.x),
      `at tick ${sample.at}: the reported column of a critter whose centre is ` +
        `at x ${sample.x} (specs/water.md: its column follows its center by ` +
        `colAt(x))`,
    );
  }

  // And it changes one column at a time, in the direction of the drift.
  for (let i = 1; i < samples.length; i += 1) {
    const step = samples[i].col - samples[i - 1].col;
    assertTrue(
      step === 0 || step === COLUMN_STEP,
      `the column between ticks ${samples[i - 1].at} and ${samples[i].at}: ` +
        `either unchanged or one column towards dir ${LANE_DIR} ` +
        `(specs/water.md), was a step of ${step} from ${samples[i - 1].col} ` +
        `to ${samples[i].col}`,
    );
  }
  assertGreaterThanOrEqual(
    Math.abs(last.col - samples[0].col),
    CROSSED_TILES,
    `the columns the drift carried the critter across, from ` +
      `${samples[0].col} to ${last.col}`,
  );

  // Nothing the page threw or logged as an error while this harness drove it.
  assertDeepEqual(harness.pageErrors, []);
});
