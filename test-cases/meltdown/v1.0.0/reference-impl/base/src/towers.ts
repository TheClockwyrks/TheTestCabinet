// Meltdown — the Tower entity: heat state, derived stats, and the coupling
// contributions cached each time the floor changes. The heat integration, the
// redline trip, firing, and Forge/Vent coupling live in game.ts, which owns the
// simulation; this class holds the per-tower state they read and write.

import { REDLINE } from "./constants";
import {
  emitterStats,
  isEmitterDef,
  moverOutput,
  TOWER_DEFS,
  type EmitterDef,
  type EmitterStats,
  type MoverDef,
} from "./defs";
import type { TowerType } from "./types";

let NEXT_ID = 1;

export class Tower {
  readonly id = NEXT_ID++;
  readonly type: TowerType;
  readonly i: number; // intersection column (1..49)
  readonly j: number; // intersection row (1..35)
  readonly cx: number; // centre px
  readonly cy: number;

  level = 1;
  totalSpend: number; // build + upgrades, for the 70% sell refund

  // Emitter thermal state.
  heat = 0; // H in [0, 100]
  tripped = false;
  tripTimer = 0;
  fireCooldown = 0; // seconds until the next shot
  firedThisStep = false; // for a brief muzzle flash in the renderer

  // Coupling contributions from neighbouring movers, recomputed on layout
  // change (game.recomputeCoupling): heat/s poured in, extra coolRate added.
  forgeHeat = 0;
  ventCool = 0;

  constructor(type: TowerType, i: number, j: number) {
    this.type = type;
    this.i = i;
    this.j = j;
    this.cx = i * 20;
    this.cy = j * 20;
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

  stats(): EmitterStats {
    return emitterStats(this.def as EmitterDef, this.level);
  }

  moverOutput(): number {
    return moverOutput(this.def as MoverDef, this.level);
  }

  // Fraction toward the redline, for the on-footprint heat read.
  heatFrac(): number {
    return this.heat / REDLINE;
  }
}
