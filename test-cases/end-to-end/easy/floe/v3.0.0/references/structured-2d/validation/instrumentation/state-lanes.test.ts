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
// frame would run the hold, the cooldown and the lanes on, and the check would be
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
// holds the lane where it stands, so the frame driven for the picture leaves the
// strait exactly as the readings below find it.
//
// A LANE ITEM'S `id`, `row`, `kind` AND `len` are read for their PRESENCE and
// their kind alone, and that is not an omission. No operation sets any of them:
// an id is the surface's own (`instrumentation/entity-ids`), the row and the kind
// are the arguments `addVehicle` and `addFloe` were given, and a kind's length in
// tiles is fixed by `specs/ice.md` and `specs/water.md`, which `ice/lane-lengths`
// and `water/lane-lengths` grade.

//
// THE RELAID LANE IS READ AS AN ARRANGEMENT, ON EACH BAND. `setLanePhase`
// replaces a lane's items rather than setting one field, so what reads back is
// what specs/instrumentation.md says it lays: the lane's own kind at the level's
// spacing, one left edge at the posed phase, and a pattern reaching both edges
// of the strait. Every other roster entry is left where it stood. The operation
// is specified for every lane, so one ice lane and one water lane are each
// relaid and read.
import { afterEach, beforeEach, it } from "vitest";
import {
  ICE_LANES,
  ITEM_LEN,
  STRAIT_W,
  TILE,
  WATER_LANES,
  laneGap,
} from "../constants";
import {
  assertContains,
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
  assertGreaterThanOrEqual,
  assertLength,
  assertLessThanOrEqual,
  fail,
} from "../assert";
import {
  captureStill,
  createHarness,
  poseLane,
  startCrossing,
  type FloeSnapshot,
  type Harness,
  type LaneDir,
} from "../harness";
import { requireFloe, requireLane, requireVehicle } from "./roster";

/** The strait the per-entity poses below are applied to. */
const VEHICLE_ROW = 12;
const FLOE_ROW = 5;
/** The lanes' poses: a left edge each, and a speed and a direction per band. */
const VEHICLE_X = 517.25;
const FLOE_X = 233.75;
const ICE_SPEED = 3.25;
const ICE_DIR: LaneDir = -1; // specs/ice.md runs row 12 rightward, so this is a real pose
const WATER_SPEED = 1.75;
const WATER_DIR: LaneDir = -1; // specs/water.md runs row 5 rightward

/** The two directions a lane may run. */
const DIRECTIONS: readonly number[] = [1, -1];

/** The column each band's posed item is laid at, one item per lane. */
const ITEM_COL = 8;

/**
 * The ice lane `setLanePhase` relays, and the phase it is relayed at: a plow
 * lane, so the kind read back differs from the car the per-entity poses act on,
 * and a left edge no tile boundary lands on.
 */
const PHASED_ROW = 14;
const PHASE_X = 401.5;

/**
 * How far a relaid item's left edge may sit from where the spacing puts it, in
 * stage units. The lane is posed rather than integrated, so this is arithmetic
 * room and nothing more: a build that lays the lane a whole tile out misses it
 * by `32`.
 */
const PHASE_TOLERANCE = 1e-6;

/**
 * The water lane `setLanePhase` relays, and the phase it is relayed at: a raft4
 * lane, so the relay is read on the water band as well as the ice, and a left
 * edge no tile boundary lands on.
 */
const PHASED_WATER_ROW = 3;
const PHASE_WATER_X = 137.5;

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
  item: FloeSnapshot["vehicles"][number] | FloeSnapshot["floes"][number],
  kinds: readonly string[],
  what: string,
): void {
  assertEqual(typeof item.id, "number", `${what}.id`);
  assertEqual(typeof item.row, "number", `${what}.row`);
  assertContains(kinds, item.kind, `${what}.kind`);
  assertEqual(typeof item.x, "number", `${what}.x, which is its LEFT EDGE`);
  assertEqual(typeof item.len, "number", `${what}.len, in tiles`);
}

/** What the relay is read off: one band's roster after `setLanePhase`. */
interface RelaidItem {
  readonly id: number;
  readonly row: number;
  readonly kind: string;
  readonly x: number;
}

/**
 * The arrangement `setLanePhase(row, x)` leaves on `row`, read off `roster`,
 * that band's items after the relay, against `lanes`, the band's table: the
 * lane's own kind at the level's spacing, one left edge at `x`, a pattern
 * reaching both edges of the strait, and every other row of the band still
 * carrying the one `noun` posed on it.
 */
function assertRelaid(
  roster: readonly RelaidItem[],
  lanes: readonly {
    readonly row: number;
    readonly kind: keyof typeof ITEM_LEN;
  }[],
  row: number,
  x: number,
  noun: string,
  spec: string,
): void {
  const relaid = roster
    .filter((item) => item.row === row)
    .sort((a, b) => a.x - b.x);
  const lane = lanes.find((entry) => entry.row === row);
  if (lane === undefined) {
    fail(`a lane of the band's table on row ${row} (${spec})`, lanes);
  }
  const gap = laneGap(row, 1) * TILE;
  const period = ITEM_LEN[lane.kind] * TILE + gap;

  assertGreaterThan(
    relaid.length,
    1,
    `the ${noun}s snapshot() reports on row ${row} after setLanePhase(${row}, ` +
      `${x}), which lays the lane's own pattern along the whole row ` +
      `(specs/instrumentation.md)`,
  );
  for (const item of relaid) {
    assertEqual(
      item.kind,
      lane.kind,
      `the kind of ${noun} ${item.id} on row ${row} after setLanePhase, which ` +
        `lays the lane's own kind (${spec})`,
    );
  }
  assertLessThanOrEqual(
    Math.min(...relaid.map((item) => Math.abs(item.x - x))),
    PHASE_TOLERANCE,
    `the nearest LEFT EDGE on row ${row} to the phase setLanePhase(${row}, ` +
      `${x}) posed`,
  );
  for (let i = 1; i < relaid.length; i += 1) {
    assertLessThanOrEqual(
      Math.abs(relaid[i].x - relaid[i - 1].x - period),
      PHASE_TOLERANCE,
      `the spacing between ${noun}s ${i - 1} and ${i} on the relaid row ` +
        `${row}, away from one period of ${period} units`,
    );
  }
  assertLessThanOrEqual(
    relaid[0].x,
    gap + PHASE_TOLERANCE,
    `the leftmost left edge on the relaid row ${row}, which one gap of ${gap} ` +
      `units bounds so the pattern reaches the left edge`,
  );
  assertGreaterThanOrEqual(
    relaid[relaid.length - 1].x + ITEM_LEN[lane.kind] * TILE,
    STRAIT_W - gap - PHASE_TOLERANCE,
    `the rightmost right edge on the relaid row ${row}, which is at most one ` +
      `gap of ${gap} units short of the strait's right edge`,
  );
  assertEqual(
    roster.filter((item) => item.row !== row).length,
    lanes.length - 1,
    `the ${noun}s on every other row of the band after setLanePhase(${row}, ` +
      `${x}), which relays that row alone`,
  );
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reports the sixteen lanes and their items and reads every pose of them back", async () => {
  startCrossing(h);

  // One vehicle in every ice lane and one floe in every water lane, each lane
  // held at a speed of 0 by `poseLane`. The two ids the poses below act on are
  // taken from the lanes they were laid in, so no lane carries an extra item.
  let vehicle = -1;
  let floe = -1;
  for (const lane of ICE_LANES) {
    const [id] = poseLane(h, lane.row, lane.kind, [ITEM_COL]);
    if (lane.row === VEHICLE_ROW) vehicle = id;
  }
  for (const lane of WATER_LANES) {
    const [id] = poseLane(h, lane.row, lane.kind, [ITEM_COL]);
    if (lane.row === FLOE_ROW) floe = id;
  }

  await h.advance(1);
  // Taken before the walk, so a pose that fails to land still leaves the picture
  // of the strait it was applied to.
  captureStill(h, "read-back");

  const s = h.snapshot();

  /** Apply one pose and read its own field straight back off the snapshot. */
  const readsBack = <T>(
    pose: () => void,
    read: (s: FloeSnapshot) => T,
    want: T,
    what: string,
  ): void => {
    pose();
    assertEqual(read(h.snapshot()), want, what);
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

  readsBack(
    () => h.debug.setVehicleX(vehicle, VEHICLE_X),
    (s) => requireVehicle(s, vehicle).x,
    VEHICLE_X,
    `the LEFT EDGE snapshot() reports for vehicle ${vehicle} after ` +
      `setVehicleX(${vehicle}, ${VEHICLE_X})`,
  );
  readsBack(
    () => h.debug.setFloeX(floe, FLOE_X),
    (s) => requireFloe(s, floe).x,
    FLOE_X,
    `the LEFT EDGE snapshot() reports for floe ${floe} after ` +
      `setFloeX(${floe}, ${FLOE_X})`,
  );

  readsBack(
    () => h.debug.setLaneSpeed(VEHICLE_ROW, ICE_SPEED),
    (s) => requireLane(s, VEHICLE_ROW).speed,
    ICE_SPEED,
    `the speed snapshot() reports for the lane on row ${VEHICLE_ROW}, in tiles ` +
      `per second, after setLaneSpeed(${VEHICLE_ROW}, ${ICE_SPEED})`,
  );
  readsBack(
    () => h.debug.setLaneDirection(VEHICLE_ROW, ICE_DIR),
    (s) => requireLane(s, VEHICLE_ROW).dir,
    ICE_DIR,
    `the direction snapshot() reports for the lane on row ${VEHICLE_ROW} after ` +
      `setLaneDirection(${VEHICLE_ROW}, ${ICE_DIR})`,
  );
  readsBack(
    () => h.debug.setLaneSpeed(FLOE_ROW, WATER_SPEED),
    (s) => requireLane(s, FLOE_ROW).speed,
    WATER_SPEED,
    `the speed snapshot() reports for the lane on row ${FLOE_ROW} after ` +
      `setLaneSpeed(${FLOE_ROW}, ${WATER_SPEED})`,
  );
  readsBack(
    () => h.debug.setLaneDirection(FLOE_ROW, WATER_DIR),
    (s) => requireLane(s, FLOE_ROW).dir,
    WATER_DIR,
    `the direction snapshot() reports for the lane on row ${FLOE_ROW} after ` +
      `setLaneDirection(${FLOE_ROW}, ${WATER_DIR})`,
  );

  // ---- A lane of each band relaid at a posed phase ----------------------

  h.debug.setLanePhase(PHASED_ROW, PHASE_X);
  const relaidIce = h.snapshot();
  assertRelaid(
    relaidIce.vehicles,
    ICE_LANES,
    PHASED_ROW,
    PHASE_X,
    "vehicle",
    "specs/ice.md",
  );

  h.debug.setLanePhase(PHASED_WATER_ROW, PHASE_WATER_X);
  const relaidWater = h.snapshot();
  assertRelaid(
    relaidWater.floes,
    WATER_LANES,
    PHASED_WATER_ROW,
    PHASE_WATER_X,
    "floe",
    "specs/water.md",
  );
  // The water relay left the ice band exactly as the ice relay laid it.
  assertDeepEqual(
    relaidWater.vehicles,
    relaidIce.vehicles,
    `the vehicles after setLanePhase(${PHASED_WATER_ROW}, ${PHASE_WATER_X}), ` +
      `which relays a water lane and leaves every other lane untouched`,
  );
});
