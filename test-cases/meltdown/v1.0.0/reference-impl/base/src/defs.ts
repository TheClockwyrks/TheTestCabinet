// Meltdown — tower and surge definitions plus the per-level derived stats.
// Numbers are the starting balance from specs/towers.md and specs/creeps.md;
// the *behaviour* built on them (heat curve, redline trip, coupling, stances)
// is implemented in towers.ts / surge.ts / game.ts.

import type { SurgeType, TowerType } from "./types";

export interface EmitterDef {
  kind: "emitter";
  name: string;
  glyph: string;
  cost: number;
  range: number; // tiles, level I
  fireRate: number; // shots/sec, level I
  baseDamage: number; // level I
  heatPerShot: number; // level I
  coolRate: number; // cooling at the redline (unchanged by level)
  airOnly?: boolean; // Flak: flyers only
  splash?: number; // Bloom: splash radius in tiles
  rimeSlow?: number[]; // Rime: cold-slow ceiling by level [I, II, III]
}

export interface MoverDef {
  kind: "forge" | "vent";
  name: string;
  glyph: string;
  cost: number;
  output: number[]; // heat/s (forge) or +coolRate (vent) by level [I, II, III]
}

export type TowerDef = EmitterDef | MoverDef;

export const TOWER_DEFS: Record<TowerType, TowerDef> = {
  arc: {
    kind: "emitter",
    name: "ARC",
    glyph: "◆", // ◆
    cost: 80,
    range: 6.0,
    fireRate: 2.0,
    baseDamage: 6,
    heatPerShot: 8,
    coolRate: 14,
  },
  stutter: {
    kind: "emitter",
    name: "STUTTER",
    glyph: "▪", // ▪
    cost: 110,
    range: 5.0,
    fireRate: 7.0,
    baseDamage: 2.0,
    heatPerShot: 3.0,
    coolRate: 13,
  },
  lance: {
    kind: "emitter",
    name: "LANCE",
    glyph: "▲", // ▲
    cost: 160,
    range: 12.0,
    fireRate: 0.8,
    baseDamage: 43,
    heatPerShot: 15,
    coolRate: 19,
  },
  bloom: {
    kind: "emitter",
    name: "BLOOM",
    glyph: "✿", // ✿
    cost: 180,
    range: 6.0,
    fireRate: 1.2,
    baseDamage: 10,
    heatPerShot: 14,
    coolRate: 14,
    splash: 2.4,
  },
  rime: {
    kind: "emitter",
    name: "RIME",
    glyph: "❄", // ❄
    cost: 110,
    range: 5.5,
    fireRate: 2.4,
    baseDamage: 4,
    heatPerShot: 6.5,
    coolRate: 15,
    rimeSlow: [0.55, 0.68, 0.8],
  },
  flak: {
    kind: "emitter",
    name: "FLAK",
    glyph: "△", // △
    cost: 130,
    range: 8.0,
    fireRate: 2.6,
    baseDamage: 6,
    heatPerShot: 5.5,
    coolRate: 13,
    airOnly: true,
  },
  forge: {
    kind: "forge",
    name: "FORGE",
    glyph: "█", // █
    cost: 60,
    output: [12, 18, 27],
  },
  vent: {
    kind: "vent",
    name: "VENT",
    glyph: "▽", // ▽
    cost: 60,
    output: [14, 21, 31.5],
  },
};

export function isEmitterDef(d: TowerDef): d is EmitterDef {
  return d.kind === "emitter";
}

// Per-level emitter stats, applied cumulatively (specs/towers.md).
export interface EmitterStats {
  range: number;
  fireRate: number;
  baseDamage: number;
  heatPerShot: number;
  coolRate: number;
  slowCeil: number; // Rime only; 0 for other emitters
}

export function emitterStats(def: EmitterDef, level: number): EmitterStats {
  const n = level - 1; // 0, 1, 2
  return {
    range: def.range + 1.0 * n,
    fireRate: def.fireRate * Math.pow(1.15, n),
    baseDamage: def.baseDamage * Math.pow(1.6, n),
    heatPerShot: def.heatPerShot * Math.pow(1.3, n),
    coolRate: def.coolRate,
    slowCeil: def.rimeSlow ? def.rimeSlow[n] : 0,
  };
}

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
  mote: { name: "Mote", hp: 40, speed: 60, slowable: true, flies: false, bounty: 4, leak: 1, radius: 8 },
  sprint: { name: "Sprint", hp: 24, speed: 120, slowable: true, flies: false, bounty: 4, leak: 1, radius: 7 },
  hulk: { name: "Hulk", hp: 220, speed: 38, slowable: true, flies: false, bounty: 10, leak: 2, radius: 12 },
  swarm: { name: "Swarm", hp: 12, speed: 70, slowable: true, flies: false, bounty: 2, leak: 1, radius: 5 },
  drift: { name: "Drift", hp: 60, speed: 80, slowable: true, flies: true, bounty: 8, leak: 1, radius: 10 },
  core: { name: "Core", hp: 1600, speed: 30, slowable: false, flies: false, bounty: 120, leak: 5, radius: 17, boss: true },
};
