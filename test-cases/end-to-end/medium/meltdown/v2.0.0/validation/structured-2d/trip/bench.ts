// Meltdown — where a trip scenario stands, and the two arrangements this group
// repeats. GROUP-LOCAL.
//
// Every item here is about ONE emitter and what the trip does to it, so the
// arrangement is always some version of the same thing: an emitter on a quiet
// anchor, and — for the items that need the crossing itself, or a shot the
// tripped tower must not fire — a mark standing in its range.
//
// A floor of 1800 tiles has a great many places to put a tower and only some of
// them are quiet for this reading. Two footprints dropped six tiles apart on the
// same rows abut, which means they CONDUCT, which is a real change to both their
// heats; a footprint dropped on one of the two straight vent-to-exhaust corridors
// lengthens a route, which is nothing to do with the trip but is a change the
// group never meant to pose. Neither is wrong — `tripped-takes-no-flow` is
// exactly the item that wants a tower abutting three others — but a check about
// the bleed that stumbled into one would be reading a flow it did not arrange.
//
// THIS FILE FIXES ARRANGEMENT AND GEOMETRY ALONE. Not one figure an item asserts
// and not one tolerance is decided here. The anchors say WHERE a footprint
// stands, `MARK_TILES` says how far out a mark stands, and neither says how far a
// build may miss by; every threshold belongs to the check that asserts it,
// derived from the figure specs/heat.md or specs/towers.md fixes for it.
//
// THE TWO TABLE LOOKUPS below are the specification's own figures, narrowed. A
// check that wants the Stutter's `heatPerShot` or the Arc's redline reaches
// `src/constants.ts` — the module the build was seeded, so the figure a check
// asserts is the figure the build was handed — rather than the snapshot, so a
// build reporting the wrong redline is caught by the item about the redline and
// never has its own number used against it.
//
// It lives in the group rather than in `harness.ts` because the arrangement it
// encodes — a gun with a mark parked in it, and a crowd of marks that never dies
// and never leaks — is what the trip items share and no other group's.

import {
  COLS,
  ROWS,
  TILE,
  TOWER_DEFS,
  emitterStats,
  type EmitterDef,
} from "../constants";
import { fail } from "../assert";
import {
  footprintCenter,
  poseTarget,
  poseTargetAt,
  sizeOf,
  towerById,
  unitById,
  type Harness,
  type MeltdownSnapshot,
  type SurgeType,
  type Tile,
  type TowerSnapshot,
  type TowerType,
  type UnitSnapshot,
} from "../harness";

/* -------------------------------------------------------------------------- */
/* Where a scenario stands                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Footprint anchors that are quiet in both senses: clear of all four openings and
 * of both straight vent-to-exhaust corridors, so a tower posed at one lengthens
 * neither route; and six tiles apart on both axes, so towers at two of them do
 * not abut even at the Lance's 4x4 footprint and neither conducts with the other.
 *
 * The left corridor runs along rows `16..19` and the top corridor down columns
 * `22..29` (specs/floor.md, The openings), and every anchor below keeps the whole
 * of a 4x4 footprint out of both.
 */
export const FREE_SITES: readonly Tile[] = [
  { col: 4, row: 4 },
  { col: 10, row: 10 },
  { col: 4, row: 24 },
  { col: 10, row: 30 },
];

/** The `index`-th quiet anchor, wrapping. */
export function freeSite(index: number): Tile {
  return FREE_SITES[index % FREE_SITES.length];
}

/** The first quiet anchor: where a scenario with one tower in it puts it. */
export const FREE_SITE: Tile = FREE_SITES[0];

/**
 * A quiet anchor with room around it for a wall on every face, a mark beyond
 * them, and nothing else near.
 *
 * A 2x2 tower here covers columns `34..35`; a 2x2 neighbour on each face reaches
 * columns `32..37` and rows `22..27`, all of it clear of both corridors, of every
 * anchor above, and of the grid's far edges at `COLS` `50` and `ROWS` `36`, and a
 * mark {@link MARK_TILES} tiles east of the centre stands two columns clear of
 * the eastern neighbour on open floor.
 */
export const BOXED_SITE: Tile = { col: 34, row: 24 };

/**
 * A quiet anchor with a clear disc of floor around it, for the one item that
 * holds a tower under a crowd.
 *
 * A 2x2 tower here covers columns `10..11` and rows `24..25`, both clear of the
 * left corridor's rows `16..19` and the top corridor's columns `22..29`, and the
 * whole of a five-tile disc around its centre lies on the grid — columns `5..17`
 * of `50` and rows `19..31` of `36` (specs/floor.md). Units standing in a
 * corridor block nothing: only a tower's footprint blocks a tile.
 */
export const CROWD_SITE: Tile = { col: 10, row: 24 };

/**
 * How far out a mark stands from the gun's footprint centre, in tiles.
 *
 * Geometry, not a tolerance. Four tiles is inside the shortest range on the
 * roster — the Stutter's `5.0` (specs/towers.md) — and outside the widest
 * arrangement this group poses, a 2x2 neighbour on each face of a 2x2 gun, whose
 * far edge is two tiles from the centre. So the same distance serves every item
 * here and no item reads a range boundary by accident.
 */
export const MARK_TILES = 4;

/**
 * The hp every mark this group poses carries.
 *
 * Far past anything a minute of any emitter's fire removes — the heaviest gun on
 * the roster, a Lance at full power, takes `43 * 3.5` a shot at `0.8` shots a
 * second (specs/towers.md, specs/heat.md), which is under `10_000` over a
 * minute — so nothing this group poses ever dies. Geometry of a sort, not a
 * tolerance: it keeps the reading on the TOWER rather than on the moment a mark
 * happened to die.
 */
export const MARK_HP = 1e6;

/* -------------------------------------------------------------------------- */
/* The specification's own figures                                            */
/* -------------------------------------------------------------------------- */

/** The emitter specs/towers.md tabulates under `type`, or a named failure. */
export function emitterDefOf(type: TowerType): EmitterDef {
  const def = TOWER_DEFS[type];
  if (def.kind !== "emitter") {
    fail("one of the six emitters (specs/towers.md)", type);
  }
  return def;
}

/** The redline specs/towers.md gives `type`. An upgrade never moves it. */
export function redlineOf(type: TowerType): number {
  return emitterDefOf(type).redline;
}

/** The thermal mass that divides every change to a `type`'s heat. */
export function massOf(type: TowerType): number {
  return emitterDefOf(type).mass;
}

/** The heat one of `type`'s shots adds at `level`, before mass divides it. */
export function heatPerShotOf(type: TowerType, level = 1): number {
  return emitterStats(emitterDefOf(type), level).heatPerShot;
}

/* -------------------------------------------------------------------------- */
/* Reading the floor back                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The tower with that id on `snapshot`, or a failure naming the id.
 *
 * Every check in this group wants the tower it posed a moment ago, so what a
 * missing one MEANS is stated once, here, rather than as an optional chain in ten
 * files. A tower gone from the roster is itself a verdict — `only-failure` says
 * a tower is never destroyed — and this is how that reads.
 */
export function towerOf(snapshot: MeltdownSnapshot, id: number): TowerSnapshot {
  const tower = towerById(snapshot, id);
  if (tower === undefined) {
    return fail(`the tower ${id} still on the floor`, "no such tower");
  }
  return tower;
}

/** The unit with that id on `snapshot`, or a failure naming the id. */
export function unitOf(snapshot: MeltdownSnapshot, id: number): UnitSnapshot {
  const unit = unitById(snapshot, id);
  if (unit === undefined) {
    return fail(`the unit ${id} still on the floor`, "no such unit");
  }
  return unit;
}

/* -------------------------------------------------------------------------- */
/* Posing a mark, and a crowd of them                                         */
/* -------------------------------------------------------------------------- */

/**
 * A stationary, effectively unkillable mark {@link MARK_TILES} tiles due east of
 * the gun's footprint centre, and its id.
 *
 * `poseTargetAt` enters a unit through the same systems the spawner uses and then
 * puts it on that exact point with its motion off and {@link MARK_HP} on it, so
 * what a check reads is whether a shot landed at all rather than the moment the
 * mark died or walked out of range (specs/instrumentation.md).
 */
export function poseMarkEast(
  h: Harness,
  gun: TowerType,
  at: Tile,
  type: SurgeType = "mote",
): number {
  const centre = footprintCenter(gun, at.col, at.row);
  return poseTargetAt(h, type, centre.x + MARK_TILES * TILE, centre.y, MARK_HP);
}

/** Whether `(col, row)` is a tile of the grid at all (specs/floor.md). */
function onGrid(col: number, row: number): boolean {
  return col >= 0 && col < COLS && row >= 0 && row < ROWS;
}

/**
 * `count` stationary, effectively unkillable marks standing on distinct tiles
 * within `radius` tiles of the gun's footprint centre, and their ids.
 *
 * The crowd `only-failure` holds a tower under. Every one of them has its motion
 * off, so none walks out of range, none reaches an exhaust and none costs a life;
 * every one carries {@link MARK_HP}, so none dies and the tower's `kills` stays a
 * reading of the trip rather than of the crowd. The tiles are walked in a fixed
 * order, so the same crowd is posed every run.
 *
 * It throws rather than posing a short crowd, because a scenario that could not
 * be arranged is a fault in the check and not a verdict about the build.
 */
export function poseCrowd(
  h: Harness,
  gun: TowerType,
  at: Tile,
  count: number,
  radius: number,
  type: SurgeType = "mote",
): number[] {
  const size = sizeOf(gun);
  const centreCol = at.col + size / 2;
  const centreRow = at.row + size / 2;
  const reach = Math.ceil(radius);
  const tiles: Tile[] = [];
  for (let row = at.row - reach; row <= at.row + size + reach; row += 1) {
    for (let col = at.col - reach; col <= at.col + size + reach; col += 1) {
      const onFootprint =
        col >= at.col &&
        col < at.col + size &&
        row >= at.row &&
        row < at.row + size;
      if (onFootprint) continue;
      if (!onGrid(col, row)) continue;
      const dx = col + 0.5 - centreCol;
      const dy = row + 0.5 - centreRow;
      if (Math.hypot(dx, dy) > radius) continue;
      tiles.push({ col, row });
    }
  }
  if (tiles.length < count) {
    throw new Error(
      `meltdown trip/bench.ts: only ${tiles.length} tiles lie within ` +
        `${radius} tiles of a ${size}x${size} at (${at.col}, ${at.row}), ` +
        `which is short of the ${count} the crowd needs`,
    );
  }
  return tiles
    .slice(0, count)
    .map((tile) => poseTarget(h, type, tile.col, tile.row, MARK_HP));
}
