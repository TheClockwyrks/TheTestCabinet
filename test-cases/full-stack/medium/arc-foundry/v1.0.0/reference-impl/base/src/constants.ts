// Arc Foundry — fixed constants: the stage, palette, grid geometry, the component stat
// tables across the quality ladder, the scrap-press roll odds and combine recipe, the
// three maps, the Load roster and its per-wave HP scaling, the economy, and the
// difficulty table. Every number that specs/*.md pins lives here so the simulation reads
// exactly as written, and this is the single balance surface a later workflow tunes
// (specs/towers.md, specs/build.md, specs/enemies.md, specs/flow.md, specs/modes.md).
//
// The model (specs/overview.md): a GemTD reskin. A component has a TYPE (one of five
// firing identities) and a quality TIER (Scrap → Tesla-Prime). Damage/range derive from
// base (Scrap) stats times the tier; fire rate is flat across quality. Every component,
// candidate, and blocker is a 2×2 wall; the Load mazes the shortest OPEN route through
// ordered waypoint platforms, never fully sealable.

import type {
  ComponentType,
  Difficulty,
  LoadType,
  MapDef,
  Refinement,
  TargetingMode,
  Tier,
} from "./types";

// ---- Stage (specs/overview.md) -------------------------------------------------
export const STAGE_W = 1280;
export const STAGE_H = 720;

export const STATUS_H = 56; // top status bar: y in [0, 56], full width
export const PANEL_X = 1000; // right build panel: x in [1000, 1280], y in [56, 720]
export const BOARD_X0 = 0;
export const BOARD_Y0 = STATUS_H;
export const BOARD_X1 = PANEL_X;
export const BOARD_Y1 = STAGE_H;

// ---- Tile grid (specs/board.md §2.2) -------------------------------------------
export const TILE = 20; // 20 × 20 px tiles
export const GRID_COLS = 50; // columns c = 0..49
export const GRID_ROWS = 33; // rows r = 0..32
export const GRID_X0 = 0; // grid anchored at the board top-left (0, 56)
export const GRID_Y0 = STATUS_H;
export const BOARD_FRAME = 4; // the y in [716, 720] strip is board frame, not playable

// A tile's center in logical-pixel space.
export function tileCenter(col: number, row: number): { x: number; y: number } {
  return { x: GRID_X0 + TILE * col + TILE / 2, y: GRID_Y0 + TILE * row + TILE / 2 };
}

// ---- Component footprint (specs/board.md §2.3 — uniform 2×2) --------------------
export const FOOTPRINT_TILES = 2; // every component / candidate / blocker is 2×2 tiles (40×40 px)
export const FOOTPRINT_PX = FOOTPRINT_TILES * TILE; // 40
// Legal anchor range for a 2×2 footprint: col 0..48, row 0..31.
export const MAX_ANCHOR_COL = GRID_COLS - FOOTPRINT_TILES; // 48
export const MAX_ANCHOR_ROW = GRID_ROWS - FOOTPRINT_TILES; // 31

// A component's center (used for range, targeting, drawing): (20·(col+1), 56 + 20·(row+1)).
export function footprintCenter(col: number, row: number): { x: number; y: number } {
  return { x: GRID_X0 + TILE * (col + 1), y: GRID_Y0 + TILE * (row + 1) };
}

// Fixed simulation timestep (specs/controls.md — a fixed tick, render interpolates).
export const FIXED_STEP = 1 / 60;

// ---- Palette (specs/overview.md) -----------------------------------------------
// Electro-industrial: a cold, oil-dark yard lit by blue-white discharge.
export const COL = {
  void: "#05080c",
  substrate: "#0d141b",
  concrete: "#141d26",
  grid: "#1d2b38",
  flow: "#2f6d92",
  arc: "#8fdcff", // the blue-white of a live arc
  spark: "#eaf6ff",
  charge: "#ffcf4a", // Charge (money)
  integrity: "#46d6e6", // Grid Integrity (lives)
  entry: "#ffd15a", // the feeder vent
  collector: "#ff6a4a", // the grounding sink (hazard)
  housing: "#37485a", // Map C transformer steel
  legal: "#46d07a", // legal placement cue
  illegal: "#ff4d4d", // illegal placement cue
  alert: "#ff5a52", // low-integrity alarm
  boss: "#c65cff", // the Dynamo
  panel: "#0f1620",
  text: "#e8eef5",
  text2: "#93a2b2",
  text3: "#5d6b7a",
  // Per-component-type accents (specs/towers.md).
  capacitor: "#5ac8ff",
  coil: "#9b7bff",
  emitter: "#7fe6b0",
  arcnode: "#ffb347",
  discharge: "#ff5470",
  blocker: "#3a4351", // inert fused-scrap rock (was "slag")
} as const;

export const FONT = `"SF Mono", "JetBrains Mono", "Fira Mono", "DejaVu Sans Mono", "Menlo", "Consolas", monospace`;

// ---- Component types (specs/towers.md) -----------------------------------------
export const COMPONENT_ORDER: ComponentType[] = ["capacitor", "coil", "emitter", "arcnode", "discharge"];

export const COMPONENT_LABEL: Record<ComponentType, string> = {
  capacitor: "CAPACITOR",
  coil: "COIL",
  emitter: "EMITTER",
  arcnode: "ARC-NODE",
  discharge: "DISCHARGE RIG",
};

export const COMPONENT_COLOR: Record<ComponentType, string> = {
  capacitor: COL.capacitor,
  coil: COL.coil,
  emitter: COL.emitter,
  arcnode: COL.arcnode,
  discharge: COL.discharge,
};

// ---- The quality ladder (specs/towers.md §1.2, §5.2) ---------------------------
export const TIERS: Tier[] = [1, 2, 3, 4, 5];
export const TIER_NAME: Record<Tier, string> = {
  1: "SCRAP",
  2: "TUNED",
  3: "CHARGED",
  4: "PRIMED",
  5: "TESLA-PRIME",
};
// Damage multiplier by tier (steep, so combining always pays). Index 0 is unused padding.
export const QUALITY_MULT: number[] = [0, 1.0, 3.0, 9.0, 40, 110];
export const RANGE_PER_TIER = 8; // range += 8 px per tier above T1 (carries reach a little farther)
export const MAX_TIER: Tier = 5; // Tesla-Prime is the apex — cannot combine further

// ---- Targeting (specs/towers.md, specs/controls.md) ----------------------------
export const TARGETING_ORDER: TargetingMode[] = ["first", "last", "nearest", "strongest", "weakest"];
export const TARGETING_LABEL: Record<TargetingMode, string> = {
  first: "FIRST",
  last: "LAST",
  nearest: "NEAREST",
  strongest: "STRONGEST",
  weakest: "WEAKEST",
};

// ---- Base (Scrap / T1) component stats (specs/towers.md §5.3) -------------------
export interface ComponentDef {
  type: ComponentType;
  name: string;
  role: string; // one-line role (inspector)
  color: string;
  range: number; // T1 range (px)
  fireRate: number; // shots/sec — FLAT across quality
  dmg: number; // T1 base damage (× QUALITY_MULT for higher tiers)
  splashT1: number; // Arc-Node: T1 splash radius (0 for the others)
  splashPerTier: number; // Arc-Node: +radius per tier above T1
}

export const COMPONENTS: Record<ComponentType, ComponentDef> = {
  capacitor: { type: "capacitor", name: "CAPACITOR", role: "Balanced single-target zap", color: COL.capacitor, range: 104, fireRate: 1.6, dmg: 8, splashT1: 0, splashPerTier: 0 },
  coil: { type: "coil", name: "COIL", role: "Chain-lightning — leaps to nearby units", color: COL.coil, range: 114, fireRate: 1.1, dmg: 6, splashT1: 0, splashPerTier: 0 },
  emitter: { type: "emitter", name: "EMITTER", role: "Rapid low-damage spark; anti-swarm", color: COL.emitter, range: 92, fireRate: 4.5, dmg: 2, splashT1: 0, splashPerTier: 0 },
  arcnode: { type: "arcnode", name: "ARC-NODE", role: "Area discharge — damages everything near impact", color: COL.arcnode, range: 100, fireRate: 0.9, dmg: 7, splashT1: 45, splashPerTier: 5 },
  discharge: { type: "discharge", name: "DISCHARGE RIG", role: "Slow, long-range heavy bolt; anti-tank", color: COL.discharge, range: 165, fireRate: 0.5, dmg: 22, splashT1: 0, splashPerTier: 0 },
};

// Coil chain (specs/towers.md §5.3): the bolt leaps to the nearest not-yet-hit unit
// within CHAIN_RANGE, each leap dealing ×CHAIN_FALLOFF of the previous. Max ADDITIONAL
// leaps by tier: 2 (T1–T2), 3 (T3–T4), 4 (Tesla-Prime).
export const COIL_CHAIN_RANGE = 70;
export const COIL_CHAIN_FALLOFF = 0.7;
export function coilLeaps(tier: Tier): number {
  return tier >= 5 ? 4 : tier >= 3 ? 3 : 2;
}

// Projectile travel speed by component (logical px/s). A shot is a real travelling
// projectile that deals its effect on impact, not a hitscan (specs/towers.md).
export const PROJECTILE_SPEED: Record<ComponentType, number> = {
  capacitor: 560,
  coil: 640,
  emitter: 680,
  arcnode: 460,
  discharge: 760,
};

// ---- Derived effective stats (the single source, specs/towers.md §5.2) ---------
export interface CompStats {
  range: number;
  fireRate: number;
  dmg: number; // per shot
  splash: number; // Arc-Node area radius (0 = single target)
  chainLeaps: number; // Coil extra leaps (0 = no chain)
  chainRange: number;
  chainFalloff: number;
}

// A component's live behaviour is fully derived from (type, tier).
export function deriveStats(type: ComponentType, tier: Tier): CompStats {
  const def = COMPONENTS[type];
  const mult = QUALITY_MULT[tier]!;
  return {
    range: def.range + RANGE_PER_TIER * (tier - 1),
    fireRate: def.fireRate, // flat across quality
    dmg: Math.round(def.dmg * mult),
    splash: def.splashT1 > 0 ? def.splashT1 + def.splashPerTier * (tier - 1) : 0,
    chainLeaps: type === "coil" ? coilLeaps(tier) : 0,
    chainRange: COIL_CHAIN_RANGE,
    chainFalloff: COIL_CHAIN_FALLOFF,
  };
}

// ---- The scrap-press build loop (specs/build.md) -------------------------------
// GemTD-faithful: place up to BUILDS_PER_LEVEL rocks a level, keep exactly one, the rest
// harden into blockers. The ROLL happens on placement, not on the STAMP click.
export const BUILDS_PER_LEVEL = 5; // fixed 5-stamp allowance per level (hard cap, constant across difficulty)
export const STAMP_COST = 10; // Charge to place one rock (capped at 5 placements/level regardless of Charge)

// Type roll: uniform 20% each (specs/build.md). Independent of Refinement.
export const STAMP_TYPE_WEIGHT: Record<ComponentType, number> = {
  capacitor: 0.2,
  coil: 0.2,
  emitter: 0.2,
  arcnode: 0.2,
  discharge: 0.2,
};

// Quality roll by Refinement level R (specs/build.md — UPGRADE QUALITY). Each row is a
// 5-tier distribution [T1..T5] that sums to 1.0; higher R biases upward. Indexed R = 0..5.
export const QUALITY_ODDS_BY_R: number[][] = [
  [0.72, 0.26, 0.02, 0.0, 0.0], //  R0 (base — Scrap-heavy; Primed/Tesla-Prime are combine-only)
  [0.55, 0.36, 0.09, 0.0, 0.0], //  R1
  [0.4, 0.42, 0.18, 0.0, 0.0], //   R2
  [0.28, 0.44, 0.28, 0.0, 0.0], //  R3
  [0.18, 0.44, 0.38, 0.0, 0.0], //  R4
  [0.1, 0.42, 0.48, 0.0, 0.0], //   R5
];

// Legacy alias: the R0 quality distribution as a tier-indexed array (index 0 unused), so
// any older reference keeps working. Prefer QUALITY_ODDS_BY_R[r].
export const STAMP_QUALITY_WEIGHT: number[] = [0, ...QUALITY_ODDS_BY_R[0]!];

export const MAX_REFINEMENT: Refinement = 5;

// UPGRADE QUALITY cost to REACH each Refinement level (from the previous), Charge.
// Indexed by target level; index 0 unused (you start at R0). specs/build.md.
export const REFINE_COST: number[] = [0, 55, 110, 200, 340, 520];

// Cost to buy the next level from the current one, or null if already at the apex.
export function nextRefineCost(r: Refinement): number | null {
  return r >= MAX_REFINEMENT ? null : REFINE_COST[r + 1]!;
}

// ---- The Load roster (specs/enemies.md §7 — base Wave-1, Medium) ---------------
export interface LoadDef {
  type: LoadType;
  label: string;
  baseHp: number; // before difficulty + per-wave scaling
  speed: number; // logical px/s (does NOT scale)
  flies: boolean;
  bounty: number; // Charge + score (does NOT scale)
  leak: number; // Grid Integrity cost (does NOT scale)
  radius: number; // visual/collision radius (logical px)
  boss: boolean;
}

export const LOAD: Record<LoadType, LoadDef> = {
  mote: { type: "mote", label: "MOTE", baseHp: 44, speed: 60, flies: false, bounty: 3, leak: 1, radius: 10, boss: false },
  spark: { type: "spark", label: "SPARK", baseHp: 27, speed: 120, flies: false, bounty: 3, leak: 1, radius: 8, boss: false },
  slug: { type: "slug", label: "SLUG", baseHp: 180, speed: 38, flies: false, bounty: 7, leak: 2, radius: 13, boss: false },
  cluster: { type: "cluster", label: "CLUSTER", baseHp: 16, speed: 72, flies: false, bounty: 2, leak: 1, radius: 7, boss: false },
  filament: { type: "filament", label: "FILAMENT", baseHp: 74, speed: 85, flies: true, bounty: 6, leak: 1, radius: 9, boss: false },
  dynamo: { type: "dynamo", label: "DYNAMO", baseHp: 1500, speed: 30, flies: false, bounty: 90, leak: 5, radius: 20, boss: true },
};

export const LOAD_ORDER: LoadType[] = ["mote", "spark", "slug", "cluster", "filament", "dynamo"];

// Per-wave HP scaling (specs/enemies.md §7.1): HP(w) = baseHP × baseMult × (1 + k·(w−1)).
// baseMult and k are set by difficulty; only HP grows — speeds, bounties, leaks are fixed.
export function scaledHp(baseHp: number, wave: number, baseMult: number, k: number): number {
  return Math.round(baseHp * baseMult * (1 + k * (wave - 1)));
}

// ---- Economy (specs/flow.md — constant across difficulty) ----------------------
// Every build phase is UNTIMED (specs/flow.md): no countdown and no early-send bonus.
// Charge is spent on placing rocks (STAMP_COST) and UPGRADE QUALITY (REFINE_COST) only —
// there is no selling or slagging.
export const START_CHARGE = 130;
export const START_INTEGRITY = 20;
export const INTEREST_RATE = 0.08; // 8% of current Charge at the start of each between-wave phase
export const INTEREST_CAP = 40; // capped at +40 per build phase

export function waveClearBonus(wave: number): number {
  return 20 + 5 * wave;
}

// Scoring (specs/flow.md §8.3): + bounty per kill, + 100·wave per wave cleared,
// + 250·integrityRemaining at victory.
export const SCORE_PER_WAVE = 100;
export const SCORE_PER_INTEGRITY = 250;

// ---- Difficulty table (specs/modes.md §9.2 — wave count + toughness ONLY) ------
export interface DifficultyDef {
  key: Difficulty;
  label: string;
  waves: number; // N
  baseMult: number; // HP base multiplier
  k: number; // per-wave HP scaling
  milestones: number[]; // waves that carry a Dynamo (round(N/2) and N)
  note: string;
}

export const DIFFICULTY: Record<Difficulty, DifficultyDef> = {
  easy: { key: "easy", label: "EASY", waves: 20, baseMult: 0.24, k: 0.8, milestones: [10, 20], note: "Shorter siege, gentler HP ramp." },
  medium: { key: "medium", label: "MEDIUM", waves: 30, baseMult: 0.22, k: 1.35, milestones: [15, 30], note: "The reference balance." },
  hard: { key: "hard", label: "HARD", waves: 40, baseMult: 0.24, k: 1.75, milestones: [20, 40], note: "Dozens of waves, a steep HP climb." },
};

export const DIFFICULTY_ORDER: Difficulty[] = ["easy", "medium", "hard"];

// A wave carries a Dynamo boss if it is a milestone wave (specs/flow.md §9.1).
export function isMilestoneWave(wave: number, diff: DifficultyDef): boolean {
  return diff.milestones.includes(wave);
}

// ---- The three maps (specs/board.md §4 — tile coordinates) ---------------------
// Every map plays the same campaign; only the topology (waypoint placement and Map C's
// fixed housings) differs. The pathing chain is [entry, ...waypoints, collector].

// Map A — "The Substation": a wide serpentine hugging the perimeter (five long legs).
const SUBSTATION: MapDef = {
  id: "substation",
  name: "The Substation",
  blurb: "A wide serpentine hugging the yard's edge — fold one big maze across the open center.",
  styleLabel: "SERPENTINE",
  entry: { col: 0, row: 4 },
  entryEdge: "left",
  waypoints: [
    { col: 47, row: 4 },
    { col: 47, row: 28 },
    { col: 2, row: 28 },
    { col: 2, row: 16 },
  ],
  collector: { col: 49, row: 16 },
  collectorEdge: "right",
  housings: [],
};

// Map B — "The Switchyard": a crossing star whose legs cut through the center four times.
const SWITCHYARD: MapDef = {
  id: "switchyard",
  name: "The Switchyard",
  blurb: "A crossing star — the legs criss-cross the middle, so the center band is the premium maze.",
  styleLabel: "BUSBAR",
  entry: { col: 25, row: 0 },
  entryEdge: "top",
  waypoints: [
    { col: 2, row: 30 },
    { col: 47, row: 2 },
    { col: 2, row: 2 },
    { col: 47, row: 30 },
  ],
  collector: { col: 25, row: 32 },
  collectorEdge: "bottom",
  housings: [],
};

// Map C — "The Transformer Yard": two fixed housings split the yard; WP2 forces the gap.
const TRANSFORMER: MapDef = {
  id: "transformer",
  name: "The Transformer Yard",
  blurb: "Two fixed transformer housings split the yard on a diagonal; the center waypoint threads the gap.",
  styleLabel: "CHOKEPOINT",
  entry: { col: 0, row: 2 },
  entryEdge: "left",
  waypoints: [
    { col: 48, row: 2 },
    { col: 24, row: 16 },
    { col: 48, row: 30 },
  ],
  collector: { col: 0, row: 30 },
  collectorEdge: "left",
  housings: [
    { col0: 12, row0: 6, col1: 19, row1: 12 },
    { col0: 30, row0: 20, col1: 37, row1: 26 },
  ],
};

export const MAPS: MapDef[] = [SUBSTATION, SWITCHYARD, TRANSFORMER];
export const DEFAULT_MAP = SUBSTATION;

export function mapById(id: string): MapDef {
  return MAPS.find((m) => m.id === id) ?? DEFAULT_MAP;
}
