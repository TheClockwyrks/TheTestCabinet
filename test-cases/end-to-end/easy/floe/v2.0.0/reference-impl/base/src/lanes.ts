// Floe — the sliding lanes: the ice band's vehicles (specs/hazards.md) and the
// water band's drifting floes (specs/water.md). Lanes are data-driven: a base
// composition per row, scaled by level. Items wrap seamlessly by a track length
// chosen to tile the strait evenly so the gaps stay uniform.

import { COLS, ICE_TOP, LEVEL_SPEED_STEP, TILE, WATER_TOP } from "./constants";
import type { Floe, Item, Lane, Vehicle, VehicleKind, FloeKind } from "./types";

const LEN: Record<VehicleKind | FloeKind, number> = {
  plow: 3,
  dogsled: 2,
  car: 2,
  pan: 1,
  raft3: 3,
  raft4: 4,
};

interface LaneSpec {
  kind: VehicleKind | FloeKind;
  dir: 1 | -1;
  speed: number; // tiles/second at level 1
  gap: number; // tiles of clear water/ice between items
}

// Ice band, rows 11 (top) .. 18 (bottom). Slower, narrow 1.5..2.5 range;
// alternating directions; plows (3t) slow, cars/dogsleds (2t) quicker.
const ICE_SPECS: LaneSpec[] = [
  { kind: "plow", dir: -1, speed: 1.7, gap: 8 }, // row 11
  { kind: "car", dir: 1, speed: 2.1, gap: 7 }, // row 12
  { kind: "dogsled", dir: -1, speed: 2.5, gap: 7 }, // row 13
  { kind: "plow", dir: 1, speed: 1.6, gap: 8 }, // row 14
  { kind: "car", dir: -1, speed: 2.0, gap: 7 }, // row 15
  { kind: "dogsled", dir: 1, speed: 2.3, gap: 7 }, // row 16
  { kind: "plow", dir: -1, speed: 1.5, gap: 8 }, // row 17
  { kind: "car", dir: 1, speed: 1.8, gap: 7 }, // row 18
];

// Water band, rows 2 (top) .. 9 (bottom). Faster, wider 3.0..5.0 range;
// alternating directions; a mix of 1-tile pans and solid 3/4-tile rafts.
const WATER_SPECS: LaneSpec[] = [
  { kind: "raft3", dir: -1, speed: 3.3, gap: 3 }, // row 2 (top, forgiving)
  { kind: "raft4", dir: 1, speed: 3.5, gap: 3 }, // row 3
  { kind: "raft3", dir: -1, speed: 4.2, gap: 3 }, // row 4
  { kind: "pan", dir: 1, speed: 3.6, gap: 2 }, // row 5
  { kind: "raft4", dir: -1, speed: 3.2, gap: 3 }, // row 6
  { kind: "raft3", dir: 1, speed: 3.8, gap: 3 }, // row 7
  { kind: "pan", dir: -1, speed: 3.4, gap: 2 }, // row 8
  { kind: "raft4", dir: 1, speed: 3.0, gap: 3 }, // row 9 (bottom, forgiving)
];

function levelSpeed(base: number, level: number): number {
  return base * Math.pow(LEVEL_SPEED_STEP, level - 1);
}

// Per level, widen gaps very slightly so the field thins as it speeds up.
function levelGap(baseGap: number, level: number): number {
  return baseGap + Math.floor((level - 1) / 3);
}

function buildLane<T extends Item>(
  row: number,
  index: number,
  spec: LaneSpec,
  level: number,
  make: (x: number, len: number) => T,
): Lane<T> {
  const len = LEN[spec.kind];
  const gap = levelGap(spec.gap, level);
  const period = len + gap; // tiles between item starts
  // A whole number of items whose track spans at least the strait plus a full
  // period, so wrapping by trackLen keeps the spacing perfectly uniform.
  const count = Math.ceil((COLS + period) / period) + 1;
  const trackLen = count * period * TILE;
  // Desync lanes so they do not line up into columns.
  const phase = (((index * 5) % period) + (index % 2) * 1.5) * TILE;
  const items: T[] = [];
  for (let i = 0; i < count; i++) {
    const x = (i * period * TILE + phase) % trackLen;
    items.push(make(x, len));
  }
  return {
    row,
    dir: spec.dir,
    speed: levelSpeed(spec.speed, level),
    trackLen,
    items,
  };
}

export interface LevelLanes {
  ice: Lane<Vehicle>[];
  water: Lane<Floe>[];
}

export function buildLevelLanes(level: number): LevelLanes {
  const ice = ICE_SPECS.map((spec, i) =>
    buildLane<Vehicle>(ICE_TOP + i, i, spec, level, (x, len) => ({
      x,
      len,
      kind: spec.kind as VehicleKind,
    })),
  );
  const water = WATER_SPECS.map((spec, i) =>
    buildLane<Floe>(WATER_TOP + i, i, spec, level, (x, len) => ({
      x,
      len,
      kind: spec.kind as FloeKind,
    })),
  );
  return { ice, water };
}

// Advance every item in a lane, wrapping to keep the pattern seamless. Items are
// kept within [0, trackLen); the renderer draws the copy that falls in view.
export function updateLane<T extends Item>(lane: Lane<T>, dt: number): void {
  const vx = lane.dir * lane.speed * TILE * dt;
  for (const it of lane.items) {
    it.x += vx;
    if (it.x >= lane.trackLen) it.x -= lane.trackLen;
    else if (it.x < 0) it.x += lane.trackLen;
  }
}

// The signed drift velocity (px/s) of a lane, for carrying a rider.
export function laneVelocity(lane: Lane<Item>): number {
  return lane.dir * lane.speed * TILE;
}

// The fixed item kind a strait row carries (an ice-band vehicle kind or a
// water-band floe kind), or null if the row is not a lane row. Derived from the
// same per-row spec tables buildLevelLanes uses, so a caller that repopulates a
// lane by row lays down the row's own kind.
export function laneKindForRow(row: number): VehicleKind | FloeKind | null {
  if (row >= ICE_TOP && row < ICE_TOP + ICE_SPECS.length) {
    return ICE_SPECS[row - ICE_TOP].kind as VehicleKind;
  }
  if (row >= WATER_TOP && row < WATER_TOP + WATER_SPECS.length) {
    return WATER_SPECS[row - WATER_TOP].kind as FloeKind;
  }
  return null;
}

// The length in tiles of a given item kind (a 3-tile plow, a 2-tile car, a
// 1-tile pan, and so on), for repopulating a lane with correctly-sized items.
export function laneItemLen(kind: VehicleKind | FloeKind): number {
  return LEN[kind];
}
