// Floe — the two bands of moving lanes.
//
// The ice band's sliding vehicles (`specs/ice.md`) and the water band's drifting
// floes (`specs/water.md`) are the same machinery with different tables, so both
// are here. A band is TWO things: a per-row motion, held on the game state as
// `iceLanes` and `waterLanes`, and a roster of items, which are actors in the
// world carrying `TAGS.vehicle` and `TAGS.floe`. Posing an item and posing a
// lane's motion are therefore independent, which is what
// `specs/instrumentation.md` asks for.
//
// HOW A LANE STAYS EVENLY SPACED FOREVER. A lane's items sit on a RING: a whole
// number of `(len + gap)` periods, wider than the strait, that every item is
// kept inside by adding or subtracting the ring's length when it leaves an end.
// So consecutive left edges are exactly one period apart everywhere in the ring,
// at every moment, and an item leaving one edge of the strait is the same item
// arriving at the other with the run of item and gap unbroken. The ring itself is
// not a figure the specification fixes, so it lives on the state as `laneRings`
// beside the motions it belongs to.
//
// The ring reaches WRAP_MARGIN past each side of the strait, so a floe carrying
// the critter is still under it when the critter's center leaves the stage: the
// off-edge death in `specs/water.md` happens before the floe would wrap.

import type { World } from "@test-cabinet/structured-2d";
import {
  ICE_LANES,
  ITEM_LEN,
  STRAIT_W,
  TAGS,
  TILE,
  WATER_LANES,
  laneGap,
  laneSpeed,
  tileCX,
  type LaneSpec,
} from "./constants";
import {
  IceFloe,
  LaneBody,
  Vehicle,
  floesOf,
  laneBodyY,
  vehiclesOf,
} from "./bodies";
import { itemKind } from "./grid";
import { random } from "./rng";
import type {
  FloeKind,
  FloeState,
  ItemKind,
  LaneRing,
  LaneState,
  VehicleKind,
} from "./game";

/** How far past each side of the strait a lane's ring reaches, in stage units. */
export const WRAP_MARGIN = 5 * TILE;

/** How many times a band's phases are redrawn before its stagger is accepted. */
const STAGGER_ATTEMPTS = 128;

/** The ring one lane's items wrap around. */
interface Ring {
  /** Stage units between one item's left edge and the next's. */
  period: number;
  /** How many items the lane carries. */
  count: number;
  /** The ring's length: `count * period`. */
  trackLen: number;
  /** The ring's left end. */
  wrapMin: number;
}

/** The ring a lane of this kind and gap runs on. */
function ringFor(kind: ItemKind, gap: number): Ring {
  const period = (ITEM_LEN[kind] + gap) * TILE;
  const count = Math.ceil((STRAIT_W + WRAP_MARGIN + period) / period);
  return { period, count, trackLen: count * period, wrapMin: -WRAP_MARGIN };
}

/** A non-negative remainder, which `%` is not for a negative dividend. */
function mod(value: number, by: number): number {
  return ((value % by) + by) % by;
}

/** Whether a lane laid out at `phase` covers a column's center. */
function phaseCovers(
  ring: Ring,
  len: number,
  phase: number,
  col: number,
): boolean {
  return mod(tileCX(col) - ring.wrapMin - phase, ring.period) < len * TILE;
}

/**
 * Whether some column is covered in EVERY row of the band, which is the one
 * thing the staggering rule forbids (`specs/ice.md`, `specs/water.md`).
 */
function coveredColumn(
  rings: readonly Ring[],
  specs: readonly LaneSpec[],
  phases: readonly number[],
): boolean {
  for (let col = 0; col < STRAIT_W / TILE; col += 1) {
    let all = true;
    for (let i = 0; i < specs.length && all; i += 1) {
      all = phaseCovers(rings[i], ITEM_LEN[specs[i].kind], phases[i], col);
    }
    if (all) return true;
  }
  return false;
}

/** One item a band's layout asks for. */
interface Placement {
  row: number;
  kind: ItemKind;
  x: number;
}

/**
 * Lay one band out for a level: its eight lanes, their rings, and the items that
 * fill them.
 *
 * Where each lane's pattern sits along its row is drawn from the game's own
 * generator. The draw is then checked against the staggering rule and one lane's
 * phase is redrawn until it holds, so the band never lays down a wall the critter
 * cannot pass — which is a rule of the specification rather than a lucky seed.
 */
function layoutBand(
  state: FloeState,
  specs: readonly LaneSpec[],
  level: number,
): { lanes: LaneState[]; rings: LaneRing[]; items: Placement[] } {
  const rings = specs.map((spec) =>
    ringFor(itemKind(spec.kind), laneGap(spec.row, level)),
  );
  const phases = rings.map((ring) => random(state) * ring.period);

  for (
    let attempt = 0;
    attempt < STAGGER_ATTEMPTS && coveredColumn(rings, specs, phases);
    attempt += 1
  ) {
    const lane = attempt % specs.length;
    phases[lane] = random(state) * rings[lane].period;
  }

  const lanes: LaneState[] = [];
  const laneRings: LaneRing[] = [];
  const items: Placement[] = [];
  specs.forEach((spec, index) => {
    const ring = rings[index];
    lanes.push({
      row: spec.row,
      dir: spec.dir,
      speed: laneSpeed(spec.row, level),
    });
    laneRings.push({
      row: spec.row,
      trackLen: ring.trackLen,
      wrapMin: ring.wrapMin,
    });
    for (let i = 0; i < ring.count; i += 1) {
      items.push({
        row: spec.row,
        kind: itemKind(spec.kind),
        x: ring.wrapMin + phases[index] + i * ring.period,
      });
    }
  });
  return { lanes, rings: laneRings, items };
}

/**
 * Lay the whole strait out for a level: both bands, both rosters, fresh ids.
 *
 * This is what a level MEANS in Floe — the sixteen lanes at that level's speeds
 * and gaps — so `setLevel` and a level advance both run it
 * (specs/progression.md, specs/instrumentation.md). It touches nothing else: not
 * the critter, the bears, the bays or the bonus catch.
 */
export function layoutLevel(
  world: World,
  state: FloeState,
  level: number,
): void {
  const ice = layoutBand(state, ICE_LANES, level);
  const water = layoutBand(state, WATER_LANES, level);

  for (const body of vehiclesOf(world)) body.destroy();
  for (const body of floesOf(world)) body.destroy();

  state.iceLanes = ice.lanes;
  state.waterLanes = water.lanes;
  state.laneRings = [...ice.rings, ...water.rings];

  for (const item of ice.items) {
    addVehicle(world, state, item.row, item.kind as VehicleKind, item.x);
  }
  for (const item of water.items) {
    addFloe(world, state, item.row, item.kind as FloeKind, item.x);
  }
}

/** The lane at a strait row, or `null` where the row carries none. */
export function laneAt(state: FloeState, row: number): LaneState | null {
  return (
    state.iceLanes.find((lane) => lane.row === row) ??
    state.waterLanes.find((lane) => lane.row === row) ??
    null
  );
}

/** The ring the row's items wrap around, or `null` where the row carries none. */
export function ringAt(state: FloeState, row: number): LaneRing | null {
  return state.laneRings.find((ring) => ring.row === row) ?? null;
}

/** Advance every lane by `dt`, wrapping each item around its lane's ring. */
export function advanceLanes(world: World, state: FloeState, dt: number): void {
  moveBand(state, state.iceLanes, vehiclesOf(world), dt);
  moveBand(state, state.waterLanes, floesOf(world), dt);
}

function moveBand(
  state: FloeState,
  lanes: readonly LaneState[],
  bodies: readonly LaneBody[],
  dt: number,
): void {
  const byRow = new Map<number, LaneBody[]>();
  for (const body of bodies) {
    const held = byRow.get(body.row);
    if (held === undefined) byRow.set(body.row, [body]);
    else held.push(body);
  }

  for (const lane of lanes) {
    const held = byRow.get(lane.row);
    if (held === undefined) continue;
    const step = lane.dir * lane.speed * TILE * dt;
    const ring = ringAt(state, lane.row);
    for (const body of held) {
      body.prevX = body.transform.x;
      body.transform.x += step;
      if (ring === null) continue;
      const wrapMax = ring.wrapMin + ring.trackLen;
      // The seam is a jump rather than travel, so the interpolation window is
      // re-anchored on the far side: an item must not be drawn streaking back
      // across the strait on the frame it wrapped.
      if (body.transform.x >= wrapMax) {
        body.transform.x -= ring.trackLen;
        body.prevX = body.transform.x;
      } else if (body.transform.x < ring.wrapMin) {
        body.transform.x += ring.trackLen;
        body.prevX = body.transform.x;
      }
    }
  }
}

/** The covering rule (specs/ice.md): a point on the item's own row. */
export function coversPoint(item: LaneBody, x: number): boolean {
  return x >= item.transform.x && x < item.transform.x + TILE * item.len;
}

/** The covering rule for a tile of the item's row: its center is covered. */
export function coversTile(item: LaneBody, col: number): boolean {
  return coversPoint(item, tileCX(col));
}

/** The vehicle covering a tile, or `null`. */
export function vehicleOnTile(
  world: World,
  col: number,
  row: number,
): Vehicle | null {
  for (const item of vehiclesOf(world)) {
    if (item.row === row && coversTile(item, col)) return item;
  }
  return null;
}

/** The vehicle covering a point on a row, or `null`. */
export function vehicleAtPoint(
  world: World,
  x: number,
  row: number,
): Vehicle | null {
  for (const item of vehiclesOf(world)) {
    if (item.row === row && coversPoint(item, x)) return item;
  }
  return null;
}

/** The floe covering a point on a row, or `null`. */
export function floeAtPoint(
  world: World,
  x: number,
  row: number,
): IceFloe | null {
  for (const item of floesOf(world)) {
    if (item.row === row && coversPoint(item, x)) return item;
  }
  return null;
}

/** The floe covering a tile of a row, or `null`. */
export function floeOnTile(
  world: World,
  col: number,
  row: number,
): IceFloe | null {
  return floeAtPoint(world, tileCX(col), row);
}

/**
 * Whether a moving vehicle covers a tile now or reaches it within `lead`
 * seconds, carrying its lane forward at its current motion (specs/hunter.md).
 *
 * A lane runs one way, so the tiles a vehicle sweeps over the lead are the span
 * between where it is and where it will be, widened by its own length.
 */
export function tileSweptWithin(
  world: World,
  state: FloeState,
  col: number,
  row: number,
  lead: number,
): boolean {
  const lane = laneAt(state, row);
  if (lane === null) return false;
  const travel = lane.dir * lane.speed * TILE * lead;
  const center = tileCX(col);
  for (const item of vehiclesOf(world)) {
    if (item.row !== row) continue;
    const from = Math.min(item.transform.x, item.transform.x + travel);
    const to =
      Math.max(item.transform.x, item.transform.x + travel) + TILE * item.len;
    if (center >= from && center < to) return true;
  }
  return false;
}

/** Put one vehicle on the ice band, appended to the roster with a fresh id. */
export function addVehicle(
  world: World,
  state: FloeState,
  row: number,
  kind: VehicleKind,
  x: number,
): Vehicle {
  return world.spawn(Vehicle, {
    transform: { x, y: laneBodyY(row) },
    tags: [TAGS.vehicle],
    configure: (body) => {
      body.id = state.nextId++;
      body.row = row;
      body.kind = kind;
      body.len = ITEM_LEN[kind];
      body.prevX = x;
    },
  });
}

/** Put one floe on the water band, appended to the roster with a fresh id. */
export function addFloe(
  world: World,
  state: FloeState,
  row: number,
  kind: FloeKind,
  x: number,
): IceFloe {
  return world.spawn(IceFloe, {
    transform: { x, y: laneBodyY(row) },
    tags: [TAGS.floe],
    configure: (body) => {
      body.id = state.nextId++;
      body.row = row;
      body.kind = kind;
      body.len = ITEM_LEN[kind];
      body.prevX = x;
    },
  });
}
