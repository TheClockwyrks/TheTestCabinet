// Floe — the sixteen lanes (`specs/ice.md`, `specs/water.md`).
//
// The two bands are laid out and advanced by one set of rules, because
// `specs/water.md` states its population model, its wrap, its staggering rule and
// its per-level scaling "in the same shape as `specs/ice.md`". What differs between
// them is the table in `src/constants.ts` and nothing else, so the ice band and the
// water band share every function here and are told apart by which roster they
// write to.
//
// THE POPULATION MODEL IS A PERIODIC TILING, and that is what makes the wrap free.
// A lane's consecutive items leave exactly `gap` tiles of clear ice between one
// item's right edge and the next's left edge, so consecutive left edges sit
// `period = (len + gap) * TILE` apart. The lane holds `count` items and its cycle is
// `count * period`, chosen wide enough that the run of item-and-gap reaches past
// both edges of the strait; every item's position stays congruent to the lane's own
// phase modulo `period`, so the spacing is exact everywhere including across the
// edge. An item carried off one edge is the same item arriving at the other, with
// its id (`specs/instrumentation.md`).
//
// THE PHASES ARE DRAWN, AND THE DRAW IS CHECKED. Where a lane's pattern sits along
// its row is drawn uniformly over one period of its spacing, and the band must
// come out staggered: no column of the strait may be covered in all eight rows at
// once. A draw that walls the band off is redrawn rather than nudged, so the
// phases stay draws.

import {
  COLS,
  ICE_LANES,
  ITEM_LEN,
  STRAIT_W,
  TILE,
  WATER_LANES,
  laneGap,
  laneSpeed,
  tileCX,
  type LaneSpec,
} from "./constants";
import { nextRandom } from "./rng";
import { coversPoint, type Span } from "./strait";
import {
  takeId,
  type MutFloe,
  type MutLane,
  type MutVehicle,
  type Sim,
} from "./sim";
import type { FloeKind, VehicleKind } from "./game";

/**
 * How many redraws a band's phases are given before the last draw stands.
 *
 * With the gaps the two tables give, a wall across all eight rows is a rare draw
 * — a tenth of draws in the water band and far fewer in the ice band — so a
 * handful of redraws makes one vanishingly unlikely. The bound is a guard against
 * an unbounded loop, not part of the rule.
 */
const MAX_STAGGER_DRAWS = 64;

/** The lane table entry for a row, ice band or water band. */
export function laneSpecAt(row: number): LaneSpec | null {
  return (
    ICE_LANES.find((lane) => lane.row === row) ??
    WATER_LANES.find((lane) => lane.row === row) ??
    null
  );
}

/** The distance between one item's left edge and the next's, in stage units. */
export function lanePeriod(row: number, level: number): number {
  const spec = laneSpecAt(row);
  if (spec === null) return STRAIT_W;
  return (ITEM_LEN[spec.kind] + laneGap(row, level)) * TILE;
}

/**
 * How many items a lane carries: enough that the run of item and gap reaches past
 * both edges of the strait, so the pattern is unbroken at each of them.
 */
export function laneCount(row: number, level: number): number {
  return Math.ceil(STRAIT_W / lanePeriod(row, level)) + 1;
}

/** The length of a lane's cycle: the whole pattern, once round the strait. */
export function laneCycle(row: number, level: number): number {
  return laneCount(row, level) * lanePeriod(row, level);
}

/** `value` reduced into `[0, modulus)`, for a negative `value` as well. */
function mod(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}

/**
 * An item's left edge held inside its lane's cycle.
 *
 * The window runs from `-len * TILE`, so an item slides off an edge rather than
 * vanishing at it: it leaves the strait only once its right edge has crossed
 * `x = 0`, and re-enters at the far end of the cycle, which is past the other edge.
 */
function wrapX(x: number, len: number, cycle: number): number {
  const lo = -len * TILE;
  return lo + mod(x - lo, cycle);
}

/** The left edges a lane at `phase` puts its items at, in cycle order. */
export function lanePositions(
  row: number,
  level: number,
  phase: number,
  len: number,
): number[] {
  const period = lanePeriod(row, level);
  const count = laneCount(row, level);
  const first = wrapX(phase, len, period);
  const positions: number[] = [];
  for (let index = 0; index < count; index += 1) {
    positions.push(first + index * period);
  }
  return positions;
}

/** Whether some column of the strait is covered on every row of `spans`. */
function hasFullColumn(rows: readonly (readonly Span[])[]): boolean {
  for (let col = 0; col < COLS; col += 1) {
    const x = tileCX(col);
    if (rows.every((items) => items.some((item) => coversPoint(item, x)))) {
      return true;
    }
  }
  return false;
}

/** One band's items, as the spans a stagger check reads. */
function bandSpans(
  lanes: readonly LaneSpec[],
  level: number,
  phases: readonly number[],
): Span[][] {
  return lanes.map((lane, index) => {
    const len = ITEM_LEN[lane.kind];
    return lanePositions(lane.row, level, phases[index], len).map((x) => ({
      row: lane.row,
      x,
      len,
    }));
  });
}

/** One phase per lane, drawn uniformly over the lane's period. */
function drawPhases(sim: Sim, lanes: readonly LaneSpec[]): number[] {
  return lanes.map((lane) => nextRandom() * lanePeriod(lane.row, sim.level));
}

/**
 * The phases one band is laid out at: drawn, and redrawn while the draw would
 * leave a column covered in every row of the band (`specs/ice.md`).
 */
function staggeredPhases(sim: Sim, lanes: readonly LaneSpec[]): number[] {
  let phases = drawPhases(sim, lanes);
  for (let attempt = 0; attempt < MAX_STAGGER_DRAWS; attempt += 1) {
    if (!hasFullColumn(bandSpans(lanes, sim.level, phases))) break;
    phases = drawPhases(sim, lanes);
  }
  return phases;
}

/** The lane motions one band runs at, at `level`. */
function bandLanes(lanes: readonly LaneSpec[], level: number): MutLane[] {
  return lanes.map((lane) => ({
    row: lane.row,
    dir: lane.dir,
    speed: laneSpeed(lane.row, level),
  }));
}

/**
 * Lay the strait out for `sim.level` (`specs/instrumentation.md`'s `setLevel`).
 *
 * The sixteen lanes take the level's speeds and gaps, and both rosters are
 * replaced by the ones the level's own population model gives, each item taking a
 * fresh id. Nothing else on the strait is touched.
 */
export function layOutStrait(sim: Sim): void {
  sim.iceLanes = bandLanes(ICE_LANES, sim.level);
  sim.waterLanes = bandLanes(WATER_LANES, sim.level);

  const icePhases = staggeredPhases(sim, ICE_LANES);
  const waterPhases = staggeredPhases(sim, WATER_LANES);

  const vehicles: MutVehicle[] = [];
  ICE_LANES.forEach((lane, index) => {
    const len = ITEM_LEN[lane.kind];
    for (const x of lanePositions(lane.row, sim.level, icePhases[index], len)) {
      vehicles.push({
        id: takeId(sim),
        row: lane.row,
        kind: lane.kind as VehicleKind,
        x,
        len,
      });
    }
  });

  const floes: MutFloe[] = [];
  WATER_LANES.forEach((lane, index) => {
    const len = ITEM_LEN[lane.kind];
    for (const x of lanePositions(
      lane.row,
      sim.level,
      waterPhases[index],
      len,
    )) {
      floes.push({
        id: takeId(sim),
        row: lane.row,
        kind: lane.kind as FloeKind,
        x,
        len,
      });
    }
  });

  sim.vehicles = vehicles;
  sim.floes = floes;
}

/**
 * Lay one lane out afresh at a posed phase (`specs/instrumentation.md`'s
 * `setLanePhase`): the row's items are replaced by the lane's own kind at the
 * level's spacing, one left edge at `x`, each with a fresh id. The lane's motion
 * and every other lane are left exactly as they stand.
 */
export function layOutLane(sim: Sim, row: number, x: number): void {
  const spec = laneSpecAt(row);
  if (spec === null) return;
  const len = ITEM_LEN[spec.kind];
  const positions = lanePositions(row, sim.level, x, len);
  if (ICE_LANES.some((lane) => lane.row === row)) {
    const kept = sim.vehicles.filter((item) => item.row !== row);
    for (const left of positions) {
      kept.push({
        id: takeId(sim),
        row,
        kind: spec.kind as VehicleKind,
        x: left,
        len,
      });
    }
    sim.vehicles = kept;
  } else {
    const kept = sim.floes.filter((item) => item.row !== row);
    for (const left of positions) {
      kept.push({
        id: takeId(sim),
        row,
        kind: spec.kind as FloeKind,
        x: left,
        len,
      });
    }
    sim.floes = kept;
  }
}

/** Advance one roster by one tick of its lanes' motion. */
function advanceBand(
  items: readonly (MutVehicle | MutFloe)[],
  lanes: readonly MutLane[],
  level: number,
  dt: number,
): void {
  for (const lane of lanes) {
    if (lane.speed <= 0) continue;
    const travel = lane.dir * lane.speed * TILE * dt;
    const cycle = laneCycle(lane.row, level);
    for (const item of items) {
      if (item.row !== lane.row) continue;
      item.x = wrapX(item.x + travel, item.len, cycle);
    }
  }
}

/** Advance both bands by one tick (`specs/ice.md`, `specs/water.md`). */
export function advanceLanes(sim: Sim, dt: number): void {
  advanceBand(sim.vehicles, sim.iceLanes, sim.level, dt);
  advanceBand(sim.floes, sim.waterLanes, sim.level, dt);
}

/**
 * Whether a vehicle of `row`'s lane will cover tile `(col, row)` within `lead`
 * seconds, carrying the lane forward at its current motion (`specs/hunter.md`).
 *
 * A lane held at a speed of `0` carries nothing forward, so it threatens nothing
 * it is not already covering.
 */
export function laneWillCover(
  sim: Sim,
  col: number,
  row: number,
  lead: number,
): boolean {
  const lane = sim.iceLanes.find((entry) => entry.row === row);
  if (lane === undefined || lane.speed <= 0) return false;
  const travel = lane.dir * lane.speed * TILE * lead;
  const x = tileCX(col);
  return sim.vehicles.some((item) => {
    if (item.row !== row) return false;
    const from = item.x;
    const to = item.x + travel;
    const lo = Math.min(from, to);
    const hi = Math.max(from, to);
    // Every left edge the item passes through over the lead, so a tile the item
    // sweeps across inside it counts even where it has moved past by the end.
    return x >= lo && x < hi + TILE * item.len;
  });
}

/** The lane speed and direction at `row`, or a lane at rest where there is none. */
export function laneMotion(
  sim: Sim,
  row: number,
): { dir: number; speed: number } {
  const lane =
    sim.iceLanes.find((entry) => entry.row === row) ??
    sim.waterLanes.find((entry) => entry.row === row);
  if (lane === undefined) return { dir: 1, speed: 0 };
  return { dir: lane.dir, speed: lane.speed };
}
