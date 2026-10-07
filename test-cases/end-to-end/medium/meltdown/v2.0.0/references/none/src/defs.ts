// Meltdown — the eight towers and the six surge types, as data.
//
// The tables are the specification's own (specs/towers.md, specs/surge.md); the
// functions below are the per-level derivations `specs/towers.md` states. Nothing
// here knows about the floor, the clock, or the screen: it is the roster, and the
// behavior built on it lives in `src/combat.ts`, `src/heat.ts` and `src/build.ts`.

import {
  FORGE_SETPOINT,
  MAX_LEVEL,
  RIME_SLOW_CEIL,
  SINK_OUTPUT,
  UPGRADE_COST_MULT,
  UPGRADE_DAMAGE,
  UPGRADE_FIRE_RATE,
  UPGRADE_HEAT,
  UPGRADE_RANGE,
} from "./constants";
import type { Side, SurgeType, TowerType } from "./types";

/** An emitter: a tower that fires, carries heat, and can trip. */
export interface EmitterDef {
  kind: "emitter";
  name: string;
  /** The footprint's side, in tiles. */
  size: number;
  /** The build cost, in money. */
  cost: number;
  /** The faces that shed heat well, in the tower's LOCAL orientation. */
  radiators: readonly Side[];
  /** Range as a radius in tiles, at level I. */
  range: number;
  /** Shots per second, at level I. */
  fireRate: number;
  /** Damage one shot removes before the heat multiplier, at level I. */
  baseDamage: number;
  /** Heat one shot adds before mass divides it, at level I. */
  heatPerShot: number;
  /** Where the damage plateau starts. Unchanged by level. */
  redline: number;
  /** The thermal mass that divides every change to this tower's heat. */
  mass: number;
  /** The Flak alone: it targets flying units and ignores every ground unit. */
  airOnly?: boolean;
  /** The Bloom alone: the radius, in tiles, its shot damages around its target. */
  splash?: number;
  /** The Rime alone: its cold-slow ceiling by level. */
  slowCeil?: readonly number[];
  /** What the shop's info panel says this tower is for. */
  blurb: string;
}

/** A mover: a tower that never fires, carries no heat, and only moves heat. */
export interface MoverDef {
  kind: "forge" | "sink";
  name: string;
  size: number;
  cost: number;
  /** The Forge's setpoint, or the Sink's per-shared-edge cooling, by level. */
  output: readonly number[];
  blurb: string;
}

export type TowerDef = EmitterDef | MoverDef;

/** The roster, in shop order (specs/towers.md). */
export const TOWER_DEFS: Record<TowerType, TowerDef> = {
  arc: {
    kind: "emitter",
    name: "ARC",
    size: 2,
    cost: 15,
    radiators: ["N", "S"],
    range: 6.0,
    fireRate: 2.0,
    baseDamage: 6,
    heatPerShot: 10.3,
    redline: 80,
    mass: 1.0,
    blurb:
      "The cheap workhorse. A low redline, so it reaches full power without much open air around it.",
  },
  stutter: {
    kind: "emitter",
    name: "STUTTER",
    size: 2,
    cost: 40,
    radiators: ["N", "E"],
    range: 5.0,
    fireRate: 7.0,
    baseDamage: 2.0,
    heatPerShot: 4.2,
    redline: 60,
    mass: 0.5,
    blurb:
      "Pours on heat fastest, on the lowest mass and the lowest redline: it spikes hard and reaches full power early.",
  },
  rime: {
    kind: "emitter",
    name: "RIME",
    size: 2,
    cost: 45,
    radiators: ["N", "S", "E"],
    range: 5.5,
    fireRate: 2.4,
    baseDamage: 4,
    heatPerShot: 7.0,
    redline: 100,
    mass: 1.1,
    slowCeil: RIME_SLOW_CEIL,
    blurb:
      "Slows what it hits, hardest when cold. Its redline sits at the trip, so it never reaches a plateau.",
  },
  flak: {
    kind: "emitter",
    name: "FLAK",
    size: 2,
    cost: 60,
    radiators: ["N", "S"],
    range: 8.0,
    fireRate: 2.6,
    baseDamage: 6,
    heatPerShot: 9.6,
    redline: 78,
    mass: 0.9,
    airOnly: true,
    blurb:
      "Dedicated anti-air: it targets flyers alone and ignores the ground.",
  },
  bloom: {
    kind: "emitter",
    name: "BLOOM",
    size: 3,
    cost: 150,
    radiators: ["N", "E"],
    range: 6.0,
    fireRate: 1.2,
    baseDamage: 10,
    heatPerShot: 27.3,
    redline: 82,
    mass: 1.8,
    splash: 2.4,
    blurb:
      "Splashes its shot around its target, so every unit inside the radius takes it in full.",
  },
  lance: {
    kind: "emitter",
    name: "LANCE",
    size: 4,
    cost: 150,
    radiators: ["N", "E"],
    range: 12.0,
    fireRate: 0.8,
    baseDamage: 43,
    heatPerShot: 48.9,
    redline: 92,
    mass: 2.8,
    blurb:
      "Hits hardest at the longest range and heats slowly for its bulk, so it wants feeding.",
  },
  forge: {
    kind: "forge",
    name: "FORGE",
    size: 2,
    cost: 20,
    output: FORGE_SETPOINT,
    blurb:
      "Warms each emitter it touches toward its setpoint, and never past it.",
  },
  sink: {
    kind: "sink",
    name: "SINK",
    size: 2,
    cost: 20,
    output: SINK_OUTPUT,
    blurb:
      "Drains each emitter it touches, through a face that would otherwise shed nothing.",
  },
};

/** Whether a roster entry is one of the six emitters. */
export function isEmitter(def: TowerDef): def is EmitterDef {
  return def.kind === "emitter";
}

/** Whether a type is one of the six emitters. */
export function isEmitterType(type: TowerType): boolean {
  return isEmitter(TOWER_DEFS[type]);
}

/** An emitter's figures at a level, with every per-level multiplier applied. */
export interface EmitterStats {
  range: number;
  fireRate: number;
  baseDamage: number;
  heatPerShot: number;
  redline: number;
  /** The Rime's cold-slow ceiling at this level; `0` on every other emitter. */
  slowCeil: number;
}

/** An emitter's stats at `level`, applied cumulatively (specs/towers.md). */
export function emitterStats(def: EmitterDef, level: number): EmitterStats {
  const n = level - 1;
  return {
    range: def.range + UPGRADE_RANGE * n,
    fireRate: def.fireRate * Math.pow(UPGRADE_FIRE_RATE, n),
    baseDamage: def.baseDamage * Math.pow(UPGRADE_DAMAGE, n),
    heatPerShot: def.heatPerShot * Math.pow(UPGRADE_HEAT, n),
    redline: def.redline,
    slowCeil: def.slowCeil ? def.slowCeil[n] : 0,
  };
}

/** A mover's own figure at `level`: the Forge's setpoint, or the Sink's output. */
export function moverOutput(def: MoverDef, level: number): number {
  return def.output[level - 1];
}

/** What it costs to take a tower from `level` to the next; `0` at the ceiling. */
export function upgradeCost(def: TowerDef, level: number): number {
  if (level >= MAX_LEVEL) return 0;
  return Math.round(def.cost * UPGRADE_COST_MULT[level - 1]);
}

/** One surge type, as `specs/surge.md` gives it. */
export interface SurgeDef {
  name: string;
  /** Base hp, before the wave's scaling. */
  hp: number;
  /** Base speed, in logical units per second. */
  speed: number;
  slowable: boolean;
  flies: boolean;
  /** The money and score a kill pays. */
  bounty: number;
  /** The lives a leak costs. */
  leak: number;
  /** The radius the unit is drawn at, which is the build's own choice. */
  radius: number;
}

export const SURGE_DEFS: Record<SurgeType, SurgeDef> = {
  mote: {
    name: "MOTE",
    hp: 40,
    speed: 60,
    slowable: true,
    flies: false,
    bounty: 3,
    leak: 1,
    radius: 6,
  },
  sprint: {
    name: "SPRINT",
    hp: 24,
    speed: 120,
    slowable: true,
    flies: false,
    bounty: 3,
    leak: 1,
    radius: 5,
  },
  hulk: {
    name: "HULK",
    hp: 220,
    speed: 38,
    slowable: true,
    flies: false,
    bounty: 7,
    leak: 2,
    radius: 9,
  },
  swarm: {
    name: "SWARM",
    hp: 12,
    speed: 70,
    slowable: true,
    flies: false,
    bounty: 2,
    leak: 1,
    radius: 4,
  },
  drift: {
    name: "DRIFT",
    hp: 60,
    speed: 80,
    slowable: true,
    flies: true,
    bounty: 6,
    leak: 1,
    radius: 8,
  },
  core: {
    name: "CORE",
    hp: 1600,
    speed: 30,
    slowable: false,
    flies: false,
    bounty: 90,
    leak: 5,
    radius: 13,
  },
};
