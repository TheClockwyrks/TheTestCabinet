// Meltdown — the Tower entity: footprint geometry (variable size + rotation),
// heat state, derived stats, and the thermal adjacency cached whenever the floor
// changes. The heat integration (surface cooling, conduction, the thermostatic
// Forge, the redline trip) and firing live in game.ts, which owns the simulation;
// this class holds the per-tower state they read and write.

import { FLOOR_X0, FLOOR_Y0, TILE } from "./constants";
import {
  emitterStats,
  isEmitterDef,
  moverOutput,
  TOWER_DEFS,
  type EmitterDef,
  type EmitterStats,
  type MoverDef,
} from "./defs";
import type { Rotation, Side, TowerType } from "./types";
import { rotateSide } from "./types";

let NEXT_ID = 1;

// A cached thermal link to a neighbouring mover or emitter: how many footprint
// edge-tiles the two share along their touching side.
export interface ThermalLink {
  other: Tower;
  edges: number;
}

export class Tower {
  readonly id = NEXT_ID++;
  readonly type: TowerType;
  readonly size: number; // footprint side in tiles (2, 3, 4)
  // Top-left footprint tile (specs/playfield.md). The footprint spans
  // [col .. col+size-1] x [row .. row+size-1].
  readonly col: number;
  readonly row: number;
  readonly cx: number; // centre px (for range / targeting / drawing)
  readonly cy: number;

  rot: Rotation = 0; // 0..3 clockwise quarter-turns of the radiator faces

  level = 1;
  totalSpend: number; // build + upgrades, for the 70% sell refund

  // Emitter thermal state.
  heat = 0; // H in [0, 100]
  tripped = false;
  tripTimer = 0;
  fireCooldown = 0; // seconds until the next shot
  firedThisStep = false; // for a brief muzzle flash in the renderer

  // Cached thermal geometry, recomputed on any layout/rotation change
  // (game.recomputeAdjacency). Air cooling comes from perimeter edge-tiles that
  // face open air (or the casing); the links carry Sink cooling, Forge heating,
  // and emitter↔emitter conduction (specs/heat.md).
  airRadEdges = 0; // air-facing edge-tiles through a radiator face
  airBaseEdges = 0; // air-facing edge-tiles through a plain face
  sinkLinks: ThermalLink[] = [];
  forgeLinks: ThermalLink[] = [];
  condLinks: ThermalLink[] = [];

  constructor(type: TowerType, col: number, row: number, rot: Rotation = 0) {
    this.type = type;
    this.size = TOWER_DEFS[type].size;
    this.col = col;
    this.row = row;
    this.rot = rot;
    this.cx = FLOOR_X0 + (col + this.size / 2) * TILE;
    this.cy = FLOOR_Y0 + (row + this.size / 2) * TILE;
    this.totalSpend = TOWER_DEFS[type].cost;
  }

  get def() {
    return TOWER_DEFS[this.type];
  }

  get isEmitter(): boolean {
    return isEmitterDef(this.def);
  }
  get isRime(): boolean {
    return this.type === "rime";
  }
  get isMover(): boolean {
    return this.type === "forge" || this.type === "sink";
  }

  stats(): EmitterStats {
    return emitterStats(this.def as EmitterDef, this.level);
  }

  moverOutput(): number {
    return moverOutput(this.def as MoverDef, this.level);
  }

  // Radiator faces in world space (local faces rotated by `rot`).
  worldRadiators(): Set<Side> {
    if (!isEmitterDef(this.def)) return new Set();
    return new Set(this.def.radiators.map((s) => rotateSide(s, this.rot)));
  }

  // Thermal mass (response speed only; equilibrium is mass-independent).
  get mass(): number {
    return isEmitterDef(this.def) ? this.def.mass : 1;
  }
  // Per-tower redline (plateau start / max-efficiency mark).
  get redline(): number {
    return isEmitterDef(this.def) ? this.def.redline : 100;
  }

  // Fraction toward the 100 trip, for the on-footprint heat read.
  heatFrac(): number {
    return this.heat / 100;
  }
}
