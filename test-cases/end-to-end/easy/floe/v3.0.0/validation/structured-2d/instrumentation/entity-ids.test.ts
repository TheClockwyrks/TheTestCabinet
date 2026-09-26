// instrumentation/entity-ids — every bear, vehicle and floe carries an id that is
// its own while it is on the strait, and keeps it across a lane wrap.
//
// specs/instrumentation.md fixes all three halves of it under Identity: "Every
// bear, vehicle, and floe carries an `id`: a number, unique among the entities
// live at any moment, reported by `snapshot` and taken by every per-entity
// operation. An entity added through the surface is appended to its roster, so it
// is the last entry and its id is read from there. An entity keeps its id for as
// long as it is on the strait, its lane wrapping at an edge included."
//
// THIS IS WHAT MAKES EVERY OTHER CHECK IN THE SUITE ADDRESSABLE. `poseBear`,
// `poseLane` and `poseVehicle` all read an id off the end of a roster and then
// hand it to `setBearStep`, `setVehicleX` or `removeFloe` many seconds later. A
// build whose ids repeat across rosters, or whose lane hands an item a new id each
// time it crosses an edge, would send those operations to the wrong body and fail
// points about mechanics that were never broken.
//
// SO THE STRAIT IS LAID OUT FULL FIRST, and the entities are added onto it. A
// level's sixteen lanes put a hundred-odd vehicles and floes on the strait, so "an
// id no live entity already carries" is a real reading rather than a comparison
// against an empty roster — and because the specification makes an id unique among
// ENTITIES rather than within a roster, each add is compared against every live
// bear, vehicle and floe at once. Six are added, two to each roster and
// interleaved, so the second of a pair is compared against the first.
//
// THE WRAP IS READ ON THE TWO PAN LANES, and the reason is arithmetic rather than
// taste. specs/water.md spaces a lane's floes so consecutive left edges are
// `(len + gap) * TILE` apart and requires the pattern to reach both edges, so the
// item nearest the leading edge is at most that far from crossing it. A pan lane
// at level `5` repeats every `(1 + 3) * 32 = 128` units and travels
// `laneSpeed * 32` units in the second this check runs — over `137` on the slower
// of the two — so a wrap inside the section is certain rather than likely, at each
// lane's OWN laid-out speed with nothing posed onto it. No ice lane repeats inside
// what a second of its own speed covers, so the ice band's ids are read across the
// same second without one.
//
// THE ADDED BEARS ARE HELD STILL, all three faculties off, and put on the near
// shore, which specs/strait.md says carries no lane. specs/hunter.md takes a bear
// off the strait when traffic arrives on it, and an id that is gone because its
// bear was legitimately removed says nothing about identity.
//
// THE LEVEL IS `SECOND_BEAR_LEVEL`, because specs/hunter.md gives a level below it
// one slot: two bears on the strait at once is a situation the specification
// allows only from level `5`, and this check adds two.

import { afterEach, beforeEach, it } from "vitest";
import {
  ROW_NEAR,
  SECOND_BEAR_LEVEL,
  STRAIT_W,
  TILE,
  laneGap,
  tileLeft,
} from "../constants";
import {
  assertEqual,
  assertGreaterThan,
  assertGreaterThanOrEqual,
  assertLength,
} from "../assert";
import {
  captureStill,
  createHarness,
  startCrossing,
  ticksFor,
  type FloeItemSnapshot,
  type FloeKind,
  type FloeSnapshot,
  type Harness,
  type VehicleKind,
} from "../harness";
import { requireLane } from "./roster";

/** The level laid out, so two bears on the strait at once is a legal situation. */
const LEVEL = SECOND_BEAR_LEVEL;

/** The game time the strait is run for, in seconds: the item's figure. */
const SECTION_SECONDS = 1;

/**
 * The two water rows the wrap is read on: the pan lanes.
 *
 * specs/water.md gives rows `5` and `8` a `pan` (`1` tile) and a gap of `2`, which
 * `laneGap` widens to `3` at this level, so their pattern repeats every `128`
 * units — less than the distance a second of either lane's own speed covers, which
 * makes a wrap inside the section certain.
 */
const PAN_ROWS: readonly number[] = [5, 8];

/** The two ice rows and the two water rows the added lane items go on. */
const ICE_ROW_A = 11;
const ICE_ROW_B = 18;
const WATER_ROW_A = 2;
const WATER_ROW_B = 9;

/** The columns the added lane items and the added bears are put at. */
const VEHICLE_COLS: readonly number[] = [4, 30];
const FLOE_COLS: readonly number[] = [6, 24];
const BEAR_COLS: readonly number[] = [2, 37];

/** The kinds the added lane items are. */
const VEHICLE_KIND: VehicleKind = "car";
const FLOE_KIND: FloeKind = "pan";

/** How far a pan lane's pattern repeats at this level, in stage units. */
const PAN_REPEAT = (1 + laneGap(PAN_ROWS[0], LEVEL)) * TILE;

/**
 * How far an item's travel must differ from its lane's own to count as a wrap, in
 * stage units.
 *
 * Half the strait. specs/water.md returns a floe carried off one edge "at the
 * other so the run of floe and open water continues unbroken", which is a jump of
 * very nearly the whole `STRAIT_W` (`1280`); a floe that merely drifted is within
 * a fraction of a unit of its lane's travel. Nothing in between is possible, so
 * the bound is set where nothing sits.
 */
const WRAP_JUMP = STRAIT_W / 2;

/** Every entity id live on the strait at one moment, whichever roster it is in. */
function liveIds(snapshot: FloeSnapshot): Set<number> {
  return new Set([
    ...snapshot.bears.map((bear) => bear.id),
    ...snapshot.vehicles.map((item) => item.id),
    ...snapshot.floes.map((item) => item.id),
  ]);
}

/** The roster an add appends to, as ids in roster order. */
type Roster = "bears" | "vehicles" | "floes";
function rosterIds(snapshot: FloeSnapshot, roster: Roster): number[] {
  if (roster === "bears") return snapshot.bears.map((bear) => bear.id);
  if (roster === "vehicles") return snapshot.vehicles.map((item) => item.id);
  return snapshot.floes.map((item) => item.id);
}

/** The floes of one row, by id. */
function floesOnRow(
  snapshot: FloeSnapshot,
  row: number,
): Map<number, FloeItemSnapshot> {
  return new Map(
    snapshot.floes
      .filter((item) => item.row === row)
      .map((item) => [item.id, item]),
  );
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("gives every added entity an id of its own and keeps it across a lane wrap", async () => {
  // `startCrossing` empties the four rosters; `setLevel` then lays the sixteen
  // lanes back out, which is what this check needs on the strait
  // (specs/instrumentation.md: setLevel replaces every vehicle and every floe by
  // the roster level n gives).
  startCrossing(h, LEVEL);
  h.debug.setLevel(LEVEL);

  const laid = h.snapshot();
  assertGreaterThan(
    laid.vehicles.length,
    0,
    `the vehicles level ${LEVEL} laid out, which every added id is compared ` +
      `against`,
  );
  assertGreaterThan(
    laid.floes.length,
    0,
    `the floes level ${LEVEL} laid out, which every added id is compared against`,
  );

  /**
   * Add one entity, and read the two halves of the rule the add itself decides:
   * its id is one no live entity already carries, and it is the last entry of its
   * roster.
   */
  const added = (roster: Roster, what: string, add: () => void): number => {
    const before = h.snapshot();
    const already = liveIds(before);
    add();
    const after = h.snapshot();

    const ids = rosterIds(after, roster);
    assertEqual(
      ids.length,
      rosterIds(before, roster).length + 1,
      `the ${roster} roster after ${what}, which appends one entity to it ` +
        `(specs/instrumentation.md)`,
    );
    const fresh = ids.filter((id) => !already.has(id));
    assertLength(
      fresh,
      1,
      `the ${roster} carrying an id no live bear, vehicle or floe already ` +
        `carried, after ${what} — an id is "unique among the entities live at ` +
        `any moment" (specs/instrumentation.md)`,
    );
    assertEqual(
      ids[ids.length - 1],
      fresh[0],
      `the last entry of the ${roster} roster after ${what}, against the id that ` +
        `was not there before it — "An entity added through the surface is ` +
        `appended to its roster, so it is the last entry and its id is read from ` +
        `there" (specs/instrumentation.md)`,
    );
    return fresh[0];
  };

  /** One bear, settled on the near shore and held there with every faculty off. */
  const addBear = (col: number): number => {
    const id = added("bears", `addBear(${col}, ${ROW_NEAR})`, () =>
      h.debug.addBear(col, ROW_NEAR),
    );
    h.debug.setBearSense(id, false);
    h.debug.setBearRouting(id, false);
    h.debug.setBearTravel(id, false);
    return id;
  };

  /** One vehicle, added to an ice lane at a column's left edge. */
  const addVehicle = (row: number, col: number): number =>
    added(
      "vehicles",
      `addVehicle(${row}, "${VEHICLE_KIND}", ${tileLeft(col)})`,
      () => h.debug.addVehicle(row, VEHICLE_KIND, tileLeft(col)),
    );

  /** One floe, added to a water lane at a column's left edge. */
  const addFloe = (row: number, col: number): number =>
    added("floes", `addFloe(${row}, "${FLOE_KIND}", ${tileLeft(col)})`, () =>
      h.debug.addFloe(row, FLOE_KIND, tileLeft(col)),
    );

  // Interleaved, and two to each roster, so the second of a pair is compared
  // against the first as well as against everything the level laid out.
  const tracked: number[] = [];
  tracked.push(addBear(BEAR_COLS[0]));
  tracked.push(addVehicle(ICE_ROW_A, VEHICLE_COLS[0]));
  tracked.push(addFloe(WATER_ROW_A, FLOE_COLS[0]));
  tracked.push(addBear(BEAR_COLS[1]));
  tracked.push(addVehicle(ICE_ROW_B, VEHICLE_COLS[1]));
  tracked.push(addFloe(WATER_ROW_B, FLOE_COLS[1]));

  // Every id on the strait, and the roster each of them is in, before the second.
  const before = h.snapshot();
  const rosterOf = new Map<number, Roster>();
  for (const roster of ["bears", "vehicles", "floes"] as const) {
    for (const id of rosterIds(before, roster)) rosterOf.set(id, roster);
  }
  const panBefore = new Map(
    PAN_ROWS.map((row) => [row, floesOnRow(before, row)]),
  );

  await h.advance(ticksFor(SECTION_SECONDS));
  const after = h.snapshot();
  // Before the assertions, so a failing roster still leaves the picture of the
  // strait it was read on.
  captureStill(h, "roster");

  // Every id the strait carried is still on it, in the roster it was in.
  const afterRoster = new Map<number, Roster>();
  for (const roster of ["bears", "vehicles", "floes"] as const) {
    for (const id of rosterIds(after, roster)) afterRoster.set(id, roster);
  }
  for (const [id, roster] of rosterOf) {
    assertEqual(
      afterRoster.get(id),
      roster,
      `the roster carrying entity ${id} after ${SECTION_SECONDS} s of game time, ` +
        `against the one it was in before — "An entity keeps its id for as long ` +
        `as it is on the strait" (specs/instrumentation.md)`,
    );
  }
  for (const id of tracked) {
    assertEqual(
      afterRoster.has(id),
      true,
      `the entity added through the surface with id ${id}, still on the strait ` +
        `after ${SECTION_SECONDS} s of game time`,
    );
  }

  // And at least one floe crossed an edge inside that second and came back with
  // the id it left with.
  const wrapped: string[] = [];
  for (const row of PAN_ROWS) {
    const lane = requireLane(after, row);
    const travel = lane.dir * lane.speed * TILE * SECTION_SECONDS;
    const wasOn = panBefore.get(row) ?? new Map<number, FloeItemSnapshot>();
    const isOn = floesOnRow(after, row);
    for (const [id, was] of wasOn) {
      const now = isOn.get(id);
      if (now === undefined) continue;
      if (Math.abs(now.x - (was.x + travel)) > WRAP_JUMP) {
        wrapped.push(`floe ${id} on row ${row}`);
      }
    }
  }
  assertGreaterThanOrEqual(
    wrapped.length,
    1,
    `the floes that crossed an edge and came back inside ${SECTION_SECONDS} s of ` +
      `game time, still carrying the id they left with — rows ` +
      `${PAN_ROWS.join(" and ")} repeat every ${PAN_REPEAT} units and cover more ` +
      `than that in the section, so specs/water.md's unbroken run across the ` +
      `edges makes one certain`,
  );
});
