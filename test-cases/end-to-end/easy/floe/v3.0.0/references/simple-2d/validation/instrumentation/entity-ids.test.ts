// instrumentation/entity-ids — every bear, vehicle and floe carries an id that is
// its own, that arrives at the end of its roster, and that stays with it.
//
// specs/instrumentation.md fixes all three, under Identity: an id is "a number,
// unique among the entities live at any moment, reported by `snapshot` and taken by
// every per-entity operation. An entity added through the surface is appended to
// its roster, so it is the last entry and its id is read from there. An entity
// keeps its id for as long as it is on the strait, its lane wrapping at an edge
// included."
//
// ALL THREE MATTER TO EVERY OTHER POINT IN THIS SUITE, because an id is how a check
// holds on to the thing it posed. A duplicate id sends a per-entity pose to the
// wrong body; an entity that did not arrive last is read as some other entity by
// the `lastBear`/`lastVehicle`/`lastFloe` a pose hands back; an id that changes
// under a lane wrap loses a check its witness in the middle of a measurement, and
// the point that fails is the one about the mechanic.
//
// THE FIRST HALF ADDS ONE OF EVERYTHING, INTERLEAVED. Bears, vehicles and floes are
// added in turn, and after each one the roster it joined is read: it must have
// grown by exactly one, the LAST entry must be the new one, and the id must be one
// no live entity of ANY roster already holds — "unique among the entities live at
// any moment" is across the strait, not within one list, so the ids are collected
// into a single set.
//
// THE SECOND HALF DRIVES THE STRAIT AND WATCHES THE IDS. The level's own traffic is
// laid out, one vehicle and one floe are added to it, and the whole roster is
// followed by id: first across a second of game time, and then on until a lane
// item WRAPS — which is read as a step against its lane's direction, the one thing
// that cannot happen while an item is merely travelling. Every id read before the
// drive must still be on the strait after it.
//
// THE WRAP IS REACHED ON THE LANE'S OWN TERMS. Where a build wraps an item is its
// own business, so nothing here asserts a position: what is derived is only HOW
// LONG a wrap can take. specs/ice.md makes a lane a repeating run of vehicle and
// gap — "consecutive left edges are `(len + gap) * TILE` units apart" — so one
// cycle of that run carries every item of the lane past the edge exactly once, and
// the cycle is measured off the lane the build actually laid out rather than
// assumed. The lane is posed at a speed of this check's own choosing so the cycle
// is spent quickly; a lane's speed is not what this point reads.
//
// THE TWO BEARS STAND ON THE MEDIAN, which specs/strait.md gives no lane, so the
// traffic rule that takes a bear off the strait (specs/hunter.md) cannot fire and
// the bears the second reading finds are the bears the first one did.

import { afterEach, beforeEach, it } from "vitest";
import { ITEM_LEN, ROW_MEDIAN, TILE, laneGap, tileLeft } from "../constants";
import {
  assertEqual,
  assertGreaterThan,
  assertLength,
  assertTrue,
  fail,
} from "../assert";
import {
  captureStill,
  createHarness,
  itemsInRow,
  lastBear,
  lastFloe,
  lastVehicle,
  laneAt,
  poseBear,
  startCrossing,
  ticksFor,
  type FloeSnapshot,
  type Harness,
} from "../harness";

/** The two tiles the bears are added on: the median, which carries no lane. */
const BEAR_TILES: readonly (readonly [number, number])[] = [
  [12, ROW_MEDIAN],
  [28, ROW_MEDIAN],
];

/** The vehicles added in the first half: one row, one kind and one column each. */
const VEHICLES: readonly (readonly [
  number,
  "plow" | "dogsled" | "car",
  number,
])[] = [
  [12, "car", 6],
  [15, "car", 18],
  [17, "plow", 30],
];

/** The floes added in the first half. */
const FLOES: readonly (readonly [number, "pan" | "raft3" | "raft4", number])[] =
  [
    [3, "raft4", 8],
    [6, "raft4", 20],
    [9, "raft4", 32],
  ];

/** The level whose own traffic the second half follows. */
const LEVEL = 1;

/**
 * The lane the wrap is watched on, and where the vehicle and the floe added to the
 * laid-out level go.
 *
 * Neither addition lands on the watched lane, so the run of items whose spacing the
 * cycle below is measured off is the one the LEVEL laid out — evenly spaced, as
 * specs/ice.md requires — rather than that run with an extra vehicle wedged into
 * it.
 */
const WRAP_ROW = 12;
const WRAP_KIND = "car";
const ADDED_VEHICLE_ROW = 14;
const ADDED_VEHICLE_COL = 4;
const ADDED_FLOE_ROW = 5;
const ADDED_FLOE_COL = 4;

/**
 * The speed the watched lane is posed at, in tiles per second.
 *
 * This check's own figure rather than the lane table's, chosen only so the lane
 * spends a whole cycle quickly: `8` tiles a second is `256` units, so a run of
 * items covering the `1280`-unit strait is carried past the edge in a few seconds.
 * `setLaneSpeed` "repopulates nothing", so the level's own layout survives the pose
 * and what is watched is still the traffic the level laid out.
 */
const WRAP_SPEED = 8;

/** A second of game time, which is the span this item names for the ids. */
const SPAN_SECONDS = 1;

/**
 * How much longer than one cycle of the lane the wrap is waited for, in seconds.
 *
 * A second of margin over a figure derived from the lane itself: every item of a
 * lane is carried past the edge exactly once per cycle (specs/ice.md), so a
 * conforming build wraps one inside a cycle and this is only slack for where in the
 * cycle the level's phase happened to start it.
 */
const WRAP_MARGIN_SECONDS = 1;

/** Every id live on the strait at that moment, across all three rosters. */
function liveIds(s: FloeSnapshot): Map<number, number> {
  const ids = new Map<number, number>();
  for (const bear of s.bears) ids.set(bear.id, bear.x);
  for (const item of s.vehicles) ids.set(item.id, item.x);
  for (const item of s.floes) ids.set(item.id, item.x);
  return ids;
}

/** Every left edge of the watched lane, oldest reading first. */
function edgesOf(s: FloeSnapshot, row: number): Map<number, number> {
  return new Map(itemsInRow(s.vehicles, row).map((item) => [item.id, item.x]));
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("gives every entity a distinct id, at the end of its roster, and keeps it", async () => {
  startCrossing(h);

  // ---- One of everything, added in turn ------------------------------------

  const seen = new Set<number>();

  /** Add one entity, and hold the roster it joined to the Identity rule. */
  const added = (
    roster: (s: FloeSnapshot) => readonly { id: number }[],
    add: () => void,
    last: (s: FloeSnapshot) => { id: number },
    what: string,
  ): number => {
    const before = roster(h.snapshot()).length;
    add();
    const after = roster(h.snapshot());
    assertLength(
      after,
      before + 1,
      `the ${what} roster after adding one, which appends exactly one entry`,
    );
    const entry = last(h.snapshot());
    assertEqual(
      entry.id,
      after[after.length - 1].id,
      `the id of the LAST entry of the ${what} roster, which is where an entity ` +
        `added through the surface arrives (specs/instrumentation.md)`,
    );
    if (seen.has(entry.id)) {
      fail(
        `an id no live entity already holds: an id is "unique among the ` +
          `entities live at any moment" across the strait ` +
          `(specs/instrumentation.md)`,
        `the ${what} added took id ${entry.id}, which was already live`,
      );
    }
    seen.add(entry.id);
    return entry.id;
  };

  for (const [index, [col, row]] of BEAR_TILES.entries()) {
    // Held still: this point reads ids, and a bear that hunted would be reading
    // another point's mechanic.
    added(
      (s) => s.bears,
      () => {
        poseBear(h, col, row, { sense: false, routing: false, travel: false });
      },
      lastBear,
      "bears",
    );
    const [vehicleRow, vehicleKind, vehicleCol] = VEHICLES[index];
    h.debug.setLaneSpeed(vehicleRow, 0);
    added(
      (s) => s.vehicles,
      () => h.debug.addVehicle(vehicleRow, vehicleKind, tileLeft(vehicleCol)),
      lastVehicle,
      "vehicles",
    );
    const [floeRow, floeKind, floeCol] = FLOES[index];
    h.debug.setLaneSpeed(floeRow, 0);
    added(
      (s) => s.floes,
      () => h.debug.addFloe(floeRow, floeKind, tileLeft(floeCol)),
      lastFloe,
      "floes",
    );
  }

  // The third vehicle and floe, so each roster is grown more than twice over.
  const [lastVehicleRow, lastVehicleKind, lastVehicleCol] = VEHICLES[2];
  h.debug.setLaneSpeed(lastVehicleRow, 0);
  added(
    (s) => s.vehicles,
    () =>
      h.debug.addVehicle(
        lastVehicleRow,
        lastVehicleKind,
        tileLeft(lastVehicleCol),
      ),
    lastVehicle,
    "vehicles",
  );
  const [lastFloeRow, lastFloeKind, lastFloeCol] = FLOES[2];
  h.debug.setLaneSpeed(lastFloeRow, 0);
  added(
    (s) => s.floes,
    () => h.debug.addFloe(lastFloeRow, lastFloeKind, tileLeft(lastFloeCol)),
    lastFloe,
    "floes",
  );

  // ---- And then the strait is driven, with every id followed ----------------

  // The level's own traffic, which is the evenly spaced run of items that wraps.
  // It replaces the vehicles and floes added above, each taking a fresh id
  // (specs/instrumentation.md); the bears are untouched by it.
  h.debug.setLevel(LEVEL);
  h.debug.addVehicle(ADDED_VEHICLE_ROW, "plow", tileLeft(ADDED_VEHICLE_COL));
  h.debug.addFloe(ADDED_FLOE_ROW, "pan", tileLeft(ADDED_FLOE_COL));
  h.debug.setLaneSpeed(WRAP_ROW, WRAP_SPEED);

  const laid = h.snapshot();
  const following = liveIds(laid);
  assertLength(
    laid.bears,
    BEAR_TILES.length,
    "the bears still on the strait once the level has been laid out",
  );
  assertGreaterThan(
    laid.vehicles.length,
    0,
    "the vehicles the level laid out, which are what the wrap below is watched on",
  );

  /** Every followed id that is no longer on the strait. */
  const lost = (s: FloeSnapshot): number[] => {
    const live = liveIds(s);
    return [...following.keys()].filter((id) => !live.has(id));
  };

  await h.advance(ticksFor(SPAN_SECONDS));
  assertLength(
    lost(h.snapshot()),
    0,
    `the followed ids no longer on the strait after ${SPAN_SECONDS} s of game ` +
      `time — an entity keeps its id for as long as it is on the strait ` +
      `(specs/instrumentation.md)`,
  );

  // How long a wrap can take, measured off the lane the build actually laid out:
  // consecutive left edges are one period apart and the run repeats, so a cycle
  // is the period times the number of items in the lane. The period is floored at
  // the figure specs/ice.md fixes — `(len + gap) * TILE` — so a build that packed
  // its lane tighter than the specification allows is still given the whole time a
  // conforming lane would take, and loses `ice/lane-gaps` rather than this point.
  const watched = itemsInRow(h.snapshot().vehicles, WRAP_ROW);
  const edges = watched.map((item) => item.x).sort((a, b) => a - b);
  const period = Math.max(
    ...edges.slice(1).map((x, index) => x - edges[index]),
    (ITEM_LEN[WRAP_KIND] + laneGap(WRAP_ROW, LEVEL)) * TILE,
  );
  const cycleSeconds = (period * watched.length) / (WRAP_SPEED * TILE);
  const dir = laneAt(h.snapshot(), WRAP_ROW).dir;

  let previous = edgesOf(h.snapshot(), WRAP_ROW);
  let wrapped: number | null = null;
  const swept = await h.until(
    (s) => {
      const now = edgesOf(s, WRAP_ROW);
      for (const [id, x] of now) {
        const was = previous.get(id);
        // A step against the lane's own direction is a wrap: an item that is
        // merely travelling always moves the way its lane runs (specs/ice.md).
        if (was !== undefined && (x - was) * dir < 0) wrapped = id;
      }
      previous = now;
      return wrapped !== null;
    },
    { maxFrames: ticksFor(cycleSeconds + WRAP_MARGIN_SECONDS) },
  );
  await h.advance(1);
  // Before the assertions, so a build that lost an id still leaves the picture of
  // the roster it was read from.
  captureStill(h, "roster");

  assertTrue(
    swept.hit,
    `a vehicle of the lane on row ${WRAP_ROW} to be carried off an edge and ` +
      `returned at the other within one cycle of the lane ` +
      `(${cycleSeconds.toFixed(2)} s at the ${WRAP_SPEED} tiles a second it was ` +
      `posed at) — specs/ice.md keeps the run of vehicle and gap unbroken across ` +
      `the strait's edges, and without a wrap this point decides nothing`,
  );
  assertLength(
    lost(swept.snapshot),
    0,
    `the followed ids no longer on the strait once a lane has wrapped — an ` +
      `entity keeps its id "its lane wrapping at an edge included" ` +
      `(specs/instrumentation.md)`,
  );
  assertTrue(
    wrapped !== null && following.has(wrapped),
    `the wrapped vehicle to be one of the entities followed from before the ` +
      `drive, carrying the id it was read with rather than a fresh one`,
  );
});
