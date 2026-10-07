// Floe — ice/crush-kills: a vehicle whose own motion brings the critter's centre
// under it costs a life, on the tick it arrives.
//
// specs/ice.md: "The critter is crushed on any tick on which a vehicle in a lane
// whose speed is above `0` covers the critter's center. It loses a life", and
// covering is the span rule — the centre lies in `[itemX, itemX + TILE * len)`.
// specs/progression.md fixes what a life costs: "`lives` drops by exactly one,
// `phase` becomes `dying`".
//
// THE TWO TICKS ARE BOTH READ OFF THE BUILD. The rule is a relation between two
// things the build itself reports — where the car is, and when the life goes —
// so the sweep below records, tick by tick, whether the car's span covers the
// critter's posed centre and whether a life has gone, and requires the two
// moments to be the same tick. Nothing here compares the crush against a tick
// this check computed from a speed: `ice/lane-speeds` grades how fast the lane
// runs, and a bound stated in absolute ticks would fail a build for a wrong lane
// speed twice over.
//
// WHAT THAT READING SEPARATES. Every wrong model of the crush lands on a
// different tick FROM THE BUILD'S OWN COVERING:
//
//   - a build that crushes on OVERLAP of the two bodies rather than on the
//     centre being covered fires while the car's left edge is still a critter's
//     half-tile short of the centre — `16` units, or thirty ticks at the posed
//     rate;
//   - a build that crushes whenever a vehicle is anywhere on the critter's ROW
//     fires on the first tick, hundreds short;
//   - a build that never crushes reaches no tick at all.
//
// The bound below is three ticks, which is what a tick boundary and the order a
// build runs its lanes and its hazards in can account for and nothing else.
//
// THE LANE'S MOTION IS POSED, both its speed and its direction, because neither
// is what this decides. The sweep is then given more than three times the game
// time that posed geometry needs, so the verdict does not turn on the lane
// running at exactly the rate it was set to.
//
// THE STRAIT IS EMPTY BUT FOR THE TWO BODIES. `startCrossing` clears both
// rosters and shuts the four world gates, so the life this loses cannot have
// come from a bear, from open water, from the crossing timer or from anything
// else that costs one (specs/progression.md).

import { assertEqual, assertLessThanOrEqual, assertTrue } from "../assert";
import { afterEach, beforeEach, it } from "vitest";
import { START_LIVES, tileCX, tileLeft } from "../constants";
import {
  captureReplay,
  createHarness,
  itemCoversPoint,
  poseLane,
  startCrossing,
  ticksFor,
  vehicleById,
  type FloeSnapshot,
  type Harness,
  type LaneDir,
  type VehicleKind,
} from "../harness";

/** The level the crossing is posed at. The crush rule is the same at each. */
const LEVEL = 1;

/** The ice lane the two bodies are posed on. Mid-band, clear of both shores. */
const LANE_ROW = 15;

/** The kind posed: a car, which the lane table gives row 15. */
const LANE_KIND: VehicleKind = "car";

/** The column the critter stands on. Mid-strait, clear of both edges. */
const CRITTER_COL = 20;

/** The column the car is parked at before the lane is released. */
const CAR_COL = 24;

/** The lane's posed motion: leftward, at the table's level-1 figure for row 15. */
const LANE_DIR: LaneDir = -1;
const LANE_SPEED = 2.0;

/**
 * How long the sweep runs for, in seconds of game time.
 *
 * The posed geometry puts the car's left edge `112` units right of the critter's
 * centre and moves it `64` units a second, so it arrives after `1.75` s. Six
 * seconds is more than three times that, which is what keeps the verdict off the
 * lane's exact rate: a build drifting at half the speed it was set to still
 * arrives well inside the sweep, and fails `ice/lane-speeds` rather than this.
 */
const SWEEP_SECONDS = 6;

/** The sweep in ticks, one tick a frame. */
const SWEEP_TICKS = ticksFor(SWEEP_SECONDS);

/**
 * How many ticks may separate the tick the car first covers the centre from the
 * tick the life goes.
 *
 * Both are read from the same build at the same tick granularity, so the only
 * honest slack is the order a build runs its two systems in: hazards after lanes
 * takes the life on the covering tick itself, hazards before lanes takes it on
 * the next, and a rate summed tick by tick can land a few parts in a quadrillion
 * either side of the boundary and cost one more. Three covers all of that and
 * stays ten times inside the nearest wrong model, which is thirty ticks away.
 */
const ARRIVAL_TOLERANCE_TICKS = 3;

/** What the sweep found: the tick each of the two moments landed on. */
interface Sweep {
  /** The first tick the car's span covered the critter's posed centre. */
  covering: number | null;
  /** The first tick a life had gone. */
  lost: number | null;
  /** The state at the tick the life went, or the last state swept. */
  atLoss: FloeSnapshot;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("costs a life on the tick a released vehicle's span reaches the critter's centre", async () => {
  startCrossing(h, LEVEL);
  h.debug.setCritterTile(CRITTER_COL, LANE_ROW);
  const [carId] = poseLane(h, LANE_ROW, LANE_KIND, [CAR_COL]);
  h.debug.setLaneDirection(LANE_ROW, LANE_DIR);

  // The scenario this check needs: the critter on the lane with its full lives,
  // and the car clear of it on the side the lane runs from.
  const posed = h.snapshot();
  const car = vehicleById(posed, carId);
  assertEqual(
    posed.lives,
    START_LIVES,
    "the crossing begins with every life still in hand (specs/progression.md)",
  );
  assertTrue(
    car !== undefined && !itemCoversPoint(car, posed.critter.x),
    `a car parked at x ${tileLeft(CAR_COL)}, clear of the critter's centre at ` +
      `x ${tileCX(CRITTER_COL)} (specs/ice.md), was ${JSON.stringify(car)}`,
  );

  // The centre the covering is read against, taken while the critter is still on
  // the strait: a life lost takes it off, and the snapshot then reports the last
  // centre it held (specs/instrumentation.md), which is this one.
  const centre = posed.critter.x;

  // Released, and swept a tick at a time so each of the two moments is the tick
  // this reads.
  const swept = await captureReplay(h, "crush", async (): Promise<Sweep> => {
    h.debug.setLaneSpeed(LANE_ROW, LANE_SPEED);
    let covering: number | null = null;
    let lost: number | null = null;
    let atLoss = h.snapshot();
    for (let tick = 1; tick <= SWEEP_TICKS; tick += 1) {
      await h.advance(1);
      const now = h.snapshot();
      const item = vehicleById(now, carId);
      if (
        covering === null &&
        item !== undefined &&
        itemCoversPoint(item, centre)
      ) {
        covering = tick;
      }
      if (lost === null && now.lives < START_LIVES) {
        lost = tick;
        atLoss = now;
      }
      if (covering !== null && lost !== null) break;
      if (lost === null) atLoss = now;
    }
    return { covering, lost, atLoss };
  });

  assertTrue(
    swept.covering !== null,
    `the released lane to carry the car's span onto the critter's centre at ` +
      `x ${centre} within ${SWEEP_SECONDS} s of game time (specs/ice.md), was ` +
      `never covered`,
  );
  assertTrue(
    swept.lost !== null,
    `a life lost as the car's span reaches the critter's centre ` +
      `(specs/ice.md), was ${swept.atLoss.lives} lives still in hand after ` +
      `${SWEEP_SECONDS} s`,
  );
  if (swept.covering === null || swept.lost === null) return;

  assertLessThanOrEqual(
    Math.abs(swept.lost - swept.covering),
    ARRIVAL_TOLERANCE_TICKS,
    `the tick the life was taken on (${swept.lost}), away from the tick the ` +
      `car's own span first covered the critter's centre (${swept.covering})`,
  );
  assertEqual(
    swept.atLoss.lives,
    START_LIVES - 1,
    "the lives left after being crushed (specs/progression.md)",
  );
  assertEqual(
    swept.atLoss.phase,
    "dying",
    "the phase a lost life leaves the crossing in (specs/progression.md)",
  );
});
