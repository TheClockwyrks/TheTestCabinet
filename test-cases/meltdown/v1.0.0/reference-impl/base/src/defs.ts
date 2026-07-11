// Meltdown — tower and surge definitions plus the per-level derived stats.
// Numbers are the starting balance from specs/towers.md and specs/creeps.md;
// the *behaviour* built on them (heat curve, redline trip, coupling, stances)
// is implemented in towers.ts / surge.ts / game.ts.

import type { Side, SurgeType, TowerType } from "./types";

export interface EmitterDef {
  kind: "emitter";
  name: string;
  glyph: string;
  cost: number;
  size: number; // footprint side in tiles (2, 3, or 4) — specs/towers.md
  radiators: Side[]; // local radiator faces (rot = 0); the rest are plain faces
  range: number; // tiles, level I
  fireRate: number; // shots/sec, level I
  baseDamage: number; // level I
  heatPerShot: number; // level I
  redline: number; // heat at max efficiency (plateau start); trip is always 100
  mass: number; // thermal mass: response speed only, not the equilibrium
  airOnly?: boolean; // Flak: flyers only
  splash?: number; // Bloom: splash radius in tiles
  rimeSlow?: number[]; // Rime: cold-slow ceiling by level [I, II, III]
}

export interface MoverDef {
  kind: "forge" | "sink";
  name: string;
  glyph: string;
  cost: number;
  size: number; // movers are 2x2
  // Forge: setpoint (target heat) by level [I, II, III].
  // Sink: per-edge cooling added by level [I, II, III].
  output: number[];
}

export type TowerDef = EmitterDef | MoverDef;

export const TOWER_DEFS: Record<TowerType, TowerDef> = {
  arc: {
    kind: "emitter",
    name: "ARC",
    glyph: "◆",
    cost: 15,
    size: 2,
    radiators: ["N", "S"],
    range: 6.0,
    fireRate: 2.0,
    baseDamage: 6,
    heatPerShot: 10.3,
    redline: 80,
    mass: 1.0,
  },
  stutter: {
    kind: "emitter",
    name: "STUTTER",
    glyph: "▪",
    cost: 40,
    size: 2,
    radiators: ["N", "E"],
    range: 5.0,
    fireRate: 7.0,
    baseDamage: 2.0,
    heatPerShot: 4.2,
    redline: 60,
    mass: 0.5,
  },
  lance: {
    kind: "emitter",
    name: "LANCE",
    glyph: "▲",
    cost: 150,
    size: 4,
    radiators: ["N", "E"],
    range: 12.0,
    fireRate: 0.8,
    baseDamage: 43,
    heatPerShot: 48.9,
    redline: 92,
    mass: 2.8,
  },
  bloom: {
    kind: "emitter",
    name: "BLOOM",
    glyph: "✿",
    cost: 150,
    size: 3,
    radiators: ["N", "E"],
    range: 6.0,
    fireRate: 1.2,
    baseDamage: 10,
    heatPerShot: 27.3,
    redline: 82,
    mass: 1.8,
    splash: 2.4,
  },
  rime: {
    kind: "emitter",
    name: "RIME",
    glyph: "❄",
    cost: 45,
    size: 2,
    radiators: ["N", "S", "E"],
    range: 5.5,
    fireRate: 2.4,
    baseDamage: 4,
    heatPerShot: 7.0,
    redline: 100, // heat-averse: no damage plateau; still trips at 100
    mass: 1.1,
    rimeSlow: [0.55, 0.68, 0.8],
  },
  flak: {
    kind: "emitter",
    name: "FLAK",
    glyph: "△",
    cost: 60,
    size: 2,
    radiators: ["N", "S"],
    range: 8.0,
    fireRate: 2.6,
    baseDamage: 6,
    heatPerShot: 9.6,
    redline: 78,
    mass: 0.9,
    airOnly: true,
  },
  forge: {
    kind: "forge",
    name: "FORGE",
    glyph: "█",
    cost: 20,
    size: 2,
    output: [72, 84, 96], // thermostat setpoint by level
  },
  sink: {
    kind: "sink",
    name: "SINK",
    glyph: "▽",
    cost: 20,
    size: 2,
    output: [16, 24, 36], // per-edge cooling added by level
  },
};

export function isEmitterDef(d: TowerDef): d is EmitterDef {
  return d.kind === "emitter";
}

// Per-level emitter stats, applied cumulatively (specs/towers.md). Size, redline,
// mass, and the radiator layout do not change with level; a maxed emitter simply
// heats faster (heatPerShot grows), a glass cannon that needs thermal support.
export interface EmitterStats {
  range: number;
  fireRate: number;
  baseDamage: number;
  heatPerShot: number;
  redline: number;
  slowCeil: number; // Rime only; 0 for other emitters
}

export function emitterStats(def: EmitterDef, level: number): EmitterStats {
  const n = level - 1; // 0, 1, 2
  return {
    range: def.range + 1.0 * n,
    fireRate: def.fireRate * Math.pow(1.15, n),
    baseDamage: def.baseDamage * Math.pow(1.6, n),
    heatPerShot: def.heatPerShot * Math.pow(1.3, n),
    redline: def.redline,
    slowCeil: def.rimeSlow ? def.rimeSlow[n] : 0,
  };
}

// Forge setpoint / Sink per-edge cooling at a given level.
export function moverOutput(def: MoverDef, level: number): number {
  return def.output[level - 1];
}

// Upgrade cost to go from the current level to the next: II costs 1.0x the
// build cost, III costs 1.8x (specs/towers.md).
export function upgradeCost(def: TowerDef, currentLevel: number): number {
  if (currentLevel === 1) return Math.round(def.cost * 1.0);
  if (currentLevel === 2) return Math.round(def.cost * 1.8);
  return 0;
}

// ---- Surge (specs/creeps.md) ---------------------------------------------

export interface SurgeDef {
  name: string;
  hp: number; // base (wave 1)
  speed: number; // logical px/s
  slowable: boolean;
  flies: boolean;
  bounty: number;
  leak: number; // lives cost
  radius: number; // draw radius (px)
  boss?: boolean;
}

export const SURGE_DEFS: Record<SurgeType, SurgeDef> = {
  mote: { name: "Mote", hp: 40, speed: 60, slowable: true, flies: false, bounty: 3, leak: 1, radius: 8 },
  sprint: { name: "Sprint", hp: 24, speed: 120, slowable: true, flies: false, bounty: 3, leak: 1, radius: 7 },
  hulk: { name: "Hulk", hp: 220, speed: 38, slowable: true, flies: false, bounty: 7, leak: 2, radius: 12 },
  swarm: { name: "Swarm", hp: 12, speed: 70, slowable: true, flies: false, bounty: 2, leak: 1, radius: 5 },
  drift: { name: "Drift", hp: 60, speed: 80, slowable: true, flies: true, bounty: 6, leak: 1, radius: 10 },
  core: { name: "Core", hp: 1600, speed: 30, slowable: false, flies: false, bounty: 90, leak: 5, radius: 17, boss: true },
};
