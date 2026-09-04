// Floe — instrumentation/state-lanes: the sixteen lanes and the two rosters on
// them are reported and read back.
//
// `specs/instrumentation.md` states the rule the whole surface is built to:
// "`snapshot` returns exactly this object. Every field an operation can set is
// present, so every operation is verifiable by setting it and reading it back."
// The rest of this suite reads its verdicts out of that object, so a field that
// is absent, that answers with something of the wrong kind, or that fails to
// report what a pose put into it costs the point that asks for it somewhere
// else, under a heading about a mechanic. This family of the shape is named
// here instead.
//
// THE SHAPE AND THE READ-BACK ARE ONE CLAIM PER FAMILY, and the families are
// separate points. A build whose bears report nothing usable must grade
// differently from one whose whole snapshot is wrong, and a single point over
// the whole surface can only fail once — so the six `instrumentation/state-*`
// points divide the object along the lines `specs/instrumentation.md` itself
// draws.
//
// EVERY POSE IS READ BEFORE ANYTHING RUNS. The harness holds the game off its own
// clock, so nothing happens between a pose and the snapshot that checks it: one
// tick would run the hold, the cooldown and the lanes on, and the check would be
// reading the update rather than the pose.
//
// EVERY VALUE IS ONE THE POSE HAD TO CARRY. Each is deliberately not the value
// `startCrossing` left behind, so a build that ignores a pose reads back the
// value it already held rather than the one asked for, and the failure names the
// operation. Each boolean is posed BOTH WAYS for the same reason: a field read
// back once could be a constant.
//
// WHAT THIS DOES NOT DECIDE. What any posed value MEANS to the simulation. That a
// posed gate holds a faculty off is each gate item's, that a posed step is
// carried out is `hunter/*`'s, and that a lane at a speed carries its items that
// far is `ice/*`'s and `water/*`'s.
//
// NO ROSTER IS EMPTY AND NO LANE IS UNREPRESENTED. An empty array satisfies "is
// an array" while saying nothing about the entries the specification describes,
// so the strait carries a vehicle in every one of the eight ice lanes and a floe
// in every one of the eight water lanes, and every per-entry field is read off a
// real entry.
//
// AND NOTHING ON IT MOVES BETWEEN THE PICTURE AND THE READING. Every lane is
// posed at a speed of `0` by `poseLane`, which `specs/instrumentation.md` says
// holds the lane where it stands, so the tick driven for the picture leaves the
// strait exactly as the readings below find it.
//
// A LANE ITEM'S `id`, `row`, `kind` AND `len` are read for their PRESENCE and
// their kind alone, and that is not an omission. No operation sets any of them:
// an id is the surface's own (`instrumentation/entity-ids`), the row and the kind
// are the arguments `addVehicle` and `addFloe` were given, and a kind's length in
// tiles is fixed by `specs/ice.md` and `specs/water.md`, which `ice/lane-lengths`
// and `water/lane-lengths` grade.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertContains,
  assertEqual,
  assertGreaterThan,
  assertLength,
} from "../assert";
import { ICE_LANES, WATER_LANES } from "../constants";
import {
  captureStill,
  createHarness,
  laneAt,
  poseLane,
  requireItem,
  startCrossing,
  type FloeSnapshot,
  type Harness,
} from "../harness";

/** The strait the per-entity poses below are applied to. */
const VEHICLE_ROW = 12;
const FLOE_ROW = 5;
/** The lanes' poses: a left edge each, and a speed and a direction per band. */
const VEHICLE_X = 517.25;
const FLOE_X = 233.75;
const ICE_SPEED = 3.25;
const ICE_DIR = -1; // specs/ice.md runs row 12 rightward, so this is a real pose
const WATER_SPEED = 1.75;
const WATER_DIR = -1; // specs/water.md runs row 5 rightward

/** The two directions a lane may run. */
const DIRECTIONS: readonly number[] = [1, -1];

/** The column each band's posed item is laid at, one item per lane. */
const ITEM_COL = 8;

/** Every field of one reported lane is of its documented kind. */
function assertLane(
  lane: FloeSnapshot["iceLanes"][number],
  what: string,
): void {
  assertEqual(typeof lane.row, "number", `${what}.row`);
  assertContains(DIRECTIONS, lane.dir, `${what}.dir`);
  assertEqual(typeof lane.speed, "number", `${what}.speed`);
}

/** Every field of one reported lane item is of its documented kind. */
function assertItem(
  item: FloeSnapshot["vehicles"][number],
  kinds: readonly string[],
  what: string,
): void {
  assertEqual(typeof item.id, "number", `${what}.id`);
  assertEqual(typeof item.row, "number", `${what}.row`);
  assertContains(kinds, item.kind, `${what}.kind`);
  assertEqual(typeof item.x, "number", `${what}.x, which is its LEFT EDGE`);
  assertEqual(typeof item.len, "number", `${what}.len, in tiles`);
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reports the sixteen lanes and their items and reads every pose of them back", async () => {
  await startCrossing(h);

  // One vehicle in every ice lane and one floe in every water lane, each lane
  // held at a speed of 0 by `poseLane`. The two ids the poses below act on are
  // taken from the lanes they were laid in, so no lane carries an extra item.
  let vehicle = -1;
  let floe = -1;
  for (const lane of ICE_LANES) {
    const [id] = await poseLane(h, lane.row, lane.kind, [ITEM_COL]);
    if (lane.row === VEHICLE_ROW) vehicle = id;
  }
  for (const lane of WATER_LANES) {
    const [id] = await poseLane(h, lane.row, lane.kind, [ITEM_COL]);
    if (lane.row === FLOE_ROW) floe = id;
  }

  await h.advance(1);
  // Taken before the walk, so a pose that fails to land still leaves the picture
  // of the strait it was applied to.
  await captureStill(h, "read-back");

  const s = await h.snapshot();

  /** Apply one pose and read its own field straight back off the snapshot. */
  const readsBack = async <T>(
    pose: () => Promise<void>,
    read: (s: FloeSnapshot) => T,
    want: T,
    what: string,
  ): Promise<void> => {
    await pose();
    assertEqual(read(await h.snapshot()), want, what);
  };

  // ---- The fields the lanes and their rosters report --------------------

  assertLength(
    s.iceLanes,
    ICE_LANES.length,
    "snapshot().iceLanes, the eight ice lanes (specs/ice.md)",
  );
  for (const lane of s.iceLanes) assertLane(lane, "snapshot().iceLanes[]");

  assertLength(
    s.waterLanes,
    WATER_LANES.length,
    "snapshot().waterLanes, the eight water lanes (specs/water.md)",
  );
  for (const lane of s.waterLanes) assertLane(lane, "snapshot().waterLanes[]");

  assertGreaterThan(
    s.vehicles.length,
    0,
    "snapshot().vehicles, of which this scenario posed one per ice lane",
  );
  for (const item of s.vehicles) {
    assertItem(item, ["plow", "dogsled", "car"], "snapshot().vehicles[]");
  }

  assertGreaterThan(
    s.floes.length,
    0,
    "snapshot().floes, of which this scenario posed one per water lane",
  );
  for (const item of s.floes) {
    assertItem(item, ["pan", "raft3", "raft4"], "snapshot().floes[]");
  }

  // ---- What each pose reads back ----------------------------------------

  await readsBack(
    () => h.debug.setVehicleX(vehicle, VEHICLE_X),
    (s) => requireItem(s, vehicle, "setVehicleX").x,
    VEHICLE_X,
    `the LEFT EDGE snapshot() reports for vehicle ${vehicle} after ` +
      `setVehicleX(${vehicle}, ${VEHICLE_X})`,
  );
  await readsBack(
    () => h.debug.setFloeX(floe, FLOE_X),
    (s) => requireItem(s, floe, "setFloeX").x,
    FLOE_X,
    `the LEFT EDGE snapshot() reports for floe ${floe} after ` +
      `setFloeX(${floe}, ${FLOE_X})`,
  );

  await readsBack(
    () => h.debug.setLaneSpeed(VEHICLE_ROW, ICE_SPEED),
    (s) => laneAt(s, VEHICLE_ROW)?.speed,
    ICE_SPEED,
    `the speed snapshot() reports for the lane on row ${VEHICLE_ROW}, in ` +
      `tiles per second, after setLaneSpeed(${VEHICLE_ROW}, ${ICE_SPEED})`,
  );
  await readsBack(
    () => h.debug.setLaneDirection(VEHICLE_ROW, ICE_DIR),
    (s) => laneAt(s, VEHICLE_ROW)?.dir,
    ICE_DIR,
    `the direction snapshot() reports for the lane on row ${VEHICLE_ROW} ` +
      `after setLaneDirection(${VEHICLE_ROW}, ${ICE_DIR})`,
  );
  await readsBack(
    () => h.debug.setLaneSpeed(FLOE_ROW, WATER_SPEED),
    (s) => laneAt(s, FLOE_ROW)?.speed,
    WATER_SPEED,
    `the speed snapshot() reports for the lane on row ${FLOE_ROW} after ` +
      `setLaneSpeed(${FLOE_ROW}, ${WATER_SPEED})`,
  );
  await readsBack(
    () => h.debug.setLaneDirection(FLOE_ROW, WATER_DIR),
    (s) => laneAt(s, FLOE_ROW)?.dir,
    WATER_DIR,
    `the direction snapshot() reports for the lane on row ${FLOE_ROW} after ` +
      `setLaneDirection(${FLOE_ROW}, ${WATER_DIR})`,
  );
});
