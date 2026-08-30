// Floe — the two bands of moving lanes.
//
// The ice band's sliding vehicles (`specs/ice.md`) and the water band's drifting
// floes (`specs/water.md`) are the same machinery with different tables, so both
// are here. A band is TWO things: a per-row motion (`Lane`, the direction and the
// speed) and a flat roster of items (`LaneItem`), each carrying its own id, row,
// kind, left edge and length. Posing an item and posing a lane's motion are
// therefore independent, which is what `specs/instrumentation.md` asks for.
//
// HOW A LANE STAYS EVENLY SPACED FOREVER. A lane's items sit on a RING: a whole
// number of `(len + gap)` periods, wider than the strait, that every item is kept
// inside by adding or subtracting the ring's length when it leaves an end. So
// consecutive left edges are exactly one period apart everywhere in the ring, at
// every moment, and an item leaving one edge of the strait is the same item
// arriving at the other with the run of item and gap unbroken.
//
// The ring reaches WRAP_MARGIN past each side of the strait, so a floe carrying
// the critter is still under it when the critter's center leaves the stage: the
// off-edge death in `specs/water.md` happens before the floe would wrap.

import {
  ICE_LANES,
  STRAIT_W,
  TILE,
  WATER_LANES,
  ITEM_LEN,
  laneGap,
  laneSpeed,
  tileCX,
  type ItemKind,
  type LaneSpec,
} from "./constants";
import { random } from "./rng";
import type { FloeState, Lane, LaneItem } from "./types";

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
  return {
    period,
    count,
    trackLen: count * period,
    wrapMin: -WRAP_MARGIN,
  };
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
 * Whether some column is covered in EVERY row of the band, which is the one thing
 * the staggering rule forbids (`specs/ice.md`, `specs/water.md`).
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

/**
 * Lay one band out for a level: its eight lanes, and the roster that fills them.
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
): { lanes: Lane[]; items: LaneItem[] } {
  const rings = specs.map((spec) =>
    ringFor(spec.kind, laneGap(spec.row, level)),
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

  const lanes: Lane[] = [];
  const items: LaneItem[] = [];
  specs.forEach((spec, index) => {
    const ring = rings[index];
    lanes.push({
      row: spec.row,
      dir: spec.dir,
      speed: laneSpeed(spec.row, level),
      trackLen: ring.trackLen,
      wrapMin: ring.wrapMin,
    });
    for (let i = 0; i < ring.count; i += 1) {
      const x = ring.wrapMin + phases[index] + i * ring.period;
      items.push({
        id: state.nextId++,
        row: spec.row,
        kind: spec.kind,
        x,
        prevX: x,
        len: ITEM_LEN[spec.kind],
      });
    }
  });
  return { lanes, items };
}

/**
 * Lay the whole strait out for a level: both bands, both rosters, fresh ids.
 *
 * This is what a level MEANS in Floe — the sixteen lanes at that level's speeds
 * and gaps — so `setLevel` and a level advance both run it (specs/progression.md,
 * specs/instrumentation.md). It touches nothing else: not the critter, the bears,
 * the bays or the bonus catch.
 */
export function layoutLevel(state: FloeState, level: number): void {
  const ice = layoutBand(state, ICE_LANES, level);
  const water = layoutBand(state, WATER_LANES, level);
  state.iceLanes = ice.lanes;
  state.vehicles = ice.items;
  state.waterLanes = water.lanes;
  state.floes = water.items;
}

/** The lane at a strait row, or `null` where the row carries none. */
export function laneAt(state: FloeState, row: number): Lane | null {
  return (
    state.iceLanes.find((lane) => lane.row === row) ??
    state.waterLanes.find((lane) => lane.row === row) ??
    null
  );
}

/** Advance every lane by `dt`, wrapping each item around its lane's ring. */
export function advanceLanes(state: FloeState, dt: number): void {
  moveBand(state.iceLanes, state.vehicles, dt);
  moveBand(state.waterLanes, state.floes, dt);
}

function moveBand(lanes: readonly Lane[], items: LaneItem[], dt: number): void {
  for (const lane of lanes) {
    const step = lane.dir * lane.speed * TILE * dt;
    const wrapMax = lane.wrapMin + lane.trackLen;
    for (const item of items) {
      if (item.row !== lane.row) continue;
      item.prevX = item.x;
      item.x += step;
      // The seam is a jump rather than travel, so the interpolation window is
      // re-anchored on the far side: an item must not be drawn streaking back
      // across the strait on the frame it wrapped.
      if (item.x >= wrapMax) {
        item.x -= lane.trackLen;
        item.prevX = item.x;
      } else if (item.x < lane.wrapMin) {
        item.x += lane.trackLen;
        item.prevX = item.x;
      }
    }
  }
}

/** The covering rule (specs/ice.md): a point on the item's own row. */
export function coversPoint(item: LaneItem, x: number): boolean {
  return x >= item.x && x < item.x + TILE * item.len;
}

/** The covering rule for a tile of the item's row: its center is covered. */
export function coversTile(item: LaneItem, col: number): boolean {
  return coversPoint(item, tileCX(col));
}

/** The vehicle covering a tile, or `null`. */
export function vehicleOnTile(
  state: FloeState,
  col: number,
  row: number,
): LaneItem | null {
  for (const item of state.vehicles) {
    if (item.row === row && coversTile(item, col)) return item;
  }
  return null;
}

/** The vehicle covering a point on a row, or `null`. */
export function vehicleAtPoint(
  state: FloeState,
  x: number,
  row: number,
): LaneItem | null {
  for (const item of state.vehicles) {
    if (item.row === row && coversPoint(item, x)) return item;
  }
  return null;
}

/** The floe covering a point on a row, or `null`. */
export function floeAtPoint(
  state: FloeState,
  x: number,
  row: number,
): LaneItem | null {
  for (const item of state.floes) {
    if (item.row === row && coversPoint(item, x)) return item;
  }
  return null;
}

/**
 * Whether a moving vehicle covers a tile now or reaches it within `lead` seconds,
 * carrying its lane forward at its current motion (`specs/hunter.md`).
 *
 * A lane runs one way, so the tiles a vehicle sweeps over the lead are the span
 * between where it is and where it will be, widened by its own length.
 */
export function tileSweptWithin(
  state: FloeState,
  col: number,
  row: number,
  lead: number,
): boolean {
  const lane = laneAt(state, row);
  if (lane === null) return false;
  const travel = lane.dir * lane.speed * TILE * lead;
  const center = tileCX(col);
  for (const item of state.vehicles) {
    if (item.row !== row) continue;
    const from = Math.min(item.x, item.x + travel);
    const to = Math.max(item.x, item.x + travel) + TILE * item.len;
    if (center >= from && center < to) return true;
  }
  return false;
}

/** Add one item to a roster, at a tile column's left edge or a bare stage `x`. */
export function addItem(
  state: FloeState,
  roster: LaneItem[],
  row: number,
  kind: ItemKind,
  x: number,
): LaneItem {
  const item: LaneItem = {
    id: state.nextId++,
    row,
    kind,
    x,
    prevX: x,
    len: ITEM_LEN[kind],
  };
  roster.push(item);
  return item;
}
