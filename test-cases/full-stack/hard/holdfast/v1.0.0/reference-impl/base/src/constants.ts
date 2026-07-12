// Holdfast — fixed constants: the stage, palette, tile-world geometry, the day/night
// clock, settler needs & mood, skills, work times, the structure table, combat and the
// threat director. Every number that the seeded specs pin lives here so the simulation
// reads exactly as written (specs/overview.md, world.md, settlers.md, economy.md,
// combat.md, time.md, controls.md, flow.md) and DESIGN.md §3.
//
// Holdfast is a top-down colony survival sim: a small band of autonomous settlers works a
// bounded frontier map — chopping, mining, hauling, building, cooking, farming — while
// their own needs and mood drift, a day/night cycle turns, and an escalating threat
// director sends ranged raids that favour the dark. There is no win; the colony holds out
// as long as it can.

import type { Phase, Stock } from "./types";

// ---- Enum / union types (the vocabulary every module shares, DESIGN §2) --------
export type TerrainKind = "soil" | "grass" | "rock"; // rock is impassable scenery + border
export type NodeKind = "tree" | "ore";
export type StructureKind =
  | "wall"
  | "door"
  | "floor"
  | "bed"
  | "stove"
  | "farm"
  | "turret";
export type WorkType = "gather" | "haul" | "build" | "cook" | "farm" | "fight"; // work-grid columns
export type Skill = "chop" | "mine" | "build" | "cook" | "shoot" | "farm";
export type JobKind =
  | "chop"
  | "mine"
  | "haul"
  | "build"
  | "cook"
  | "sow"
  | "harvest"
  | "fight"
  | "tend"
  | "eat"
  | "sleep";
export type Activity =
  | "idle"
  | "walk"
  | "chop"
  | "mine"
  | "haul"
  | "build"
  | "cook"
  | "farm"
  | "fight"
  | "tend"
  | "eat"
  | "sleep"
  | "flee"
  | "downed";
export type ResourceKind = "wood" | "ore" | "crops" | "meals";
export type Tool = "none" | "designate" | "cancel" | "build";

export const STRUCTURE_ORDER: StructureKind[] = [
  "wall",
  "door",
  "floor",
  "bed",
  "stove",
  "farm",
  "turret",
];
export const WORK_ORDER: WorkType[] = ["gather", "haul", "build", "cook", "farm", "fight"];
export const WORK_LABEL: Record<WorkType, string> = {
  gather: "Gather",
  haul: "Haul",
  build: "Build",
  cook: "Cook",
  farm: "Farm",
  fight: "Fight",
};
export const SKILL_ORDER: Skill[] = ["chop", "mine", "build", "cook", "shoot", "farm"];
export const RESOURCE_ORDER: ResourceKind[] = ["wood", "ore", "crops", "meals"];

// ---- 3.1 Stage, grid, camera (specs/overview.md, world.md, controls.md) --------
export const STAGE_W = 1280;
export const STAGE_H = 720;

export const TOP_H = 64; // top HUD strip: y in [0, 64], full width
export const BOT_Y = 656; // bottom HUD strip top: y in [656, 720]
// Colony view (the camera) fills the middle band.
export const VIEW_X0 = 0;
export const VIEW_Y0 = TOP_H; // 64
export const VIEW_X1 = STAGE_W; // 1280
export const VIEW_Y1 = BOT_Y; // 656
export const VIEW_W = VIEW_X1 - VIEW_X0; // 1280
export const VIEW_H = VIEW_Y1 - VIEW_Y0; // 592

export const TILE = 24; // px per tile
export const COLS = 60;
export const ROWS = 44;
export const WORLD_W = COLS * TILE; // 1440
export const WORLD_H = ROWS * TILE; // 1056
export const BORDER = 1; // outer 1-tile ring is sealed rock

export const CAM_PAN = 520; // px/s keyboard / edge pan
export const ZOOM_LEVELS = [0.85, 1.0, 1.3];
export const ZOOM_DEFAULT_INDEX = 1; // 1.0×
export const EDGE_SCROLL = 24; // px margin near view edges that pans

// ---- 3.2 Simulation clock and time-of-day (controls.md, time.md) ---------------
export const FIXED_STEP = 0.1; // s — 10 ticks/s; render interpolates between ticks
export const SPEEDS = [1, 2, 3]; // ticks-per-real-second scale (keys 1/2/3); Space pauses
export const DAY_SECONDS = 90; // one full day/night cycle at 1× (900 ticks)

// Phase split over the day clock `time` in [0, 1): ~60% lit, ~40% dark.
export const PHASE_DAWN_END = 0.1; // dawn  [0.00, 0.10)
export const PHASE_DAY_END = 0.5; //  day   [0.10, 0.50)
export const PHASE_DUSK_END = 0.6; // dusk  [0.50, 0.60)
//                                    night [0.60, 1.00)
export function phaseOf(time: number): Phase {
  const t = time - Math.floor(time);
  if (t < PHASE_DAWN_END) return "dawn";
  if (t < PHASE_DAY_END) return "day";
  if (t < PHASE_DUSK_END) return "dusk";
  return "night";
}
// Daylight (farms grow, settlers work) is dawn/day/dusk; only "night" is dark.
export function isDaylight(phase: Phase): boolean {
  return phase !== "night";
}

export const START_DAY = 1;
export const START_TIME = 0.05; // open at dawn, an opening scramble in daylight
export const NIGHT_DARKEN = 0.55; // max lighting-overlay alpha toward mid-night (never black-out)

// ---- 3.3 Needs and mood (per real second at 1×, settlers.md) -------------------
export const HUNGER_RISE = 1 / 135; // /s — climbs while awake (~1.5 days to starving)
export const EAT_THRESHOLD = 0.7; // at/above hunger, seek a meal if any in stock
export const EAT_TIME = 2.0; // s to consume one meal, resets hunger to 0
export const STARVE_HP = 6; // hp/s drained once hunger >= 1.0
export const REST_DRAIN_DAY = 1 / 150; // /s — rest falls while working by day
export const REST_NIGHT_MUL = 1.7; // rest drains faster after dark
export const SLEEP_REST_BED = 1 / 40; // /s recovered in a bed
export const SLEEP_REST_GROUND = 1 / 70; // /s recovered on the ground (slower, mood hit)
export const SLEEP_TRIGGER_DAY = 0.28; // rest <= this any time → sleep
export const SLEEP_TRIGGER_NIGHT = 0.55; // rest <= this at night → sleep (preference)
export const SLEEP_WAKE = 0.95; // rest >= this → wake

export const MOOD_BASE = 0.7; // recomputed each tick from needs + events
// Penalties (subtracted while the condition holds).
export const MOOD_PEN_HUNGRY = 0.25;
export const MOOD_PEN_EXHAUSTED = 0.25;
export const MOOD_PEN_GROUND = 0.08; // slept on the ground
export const MOOD_PEN_COMBAT = 0.15; // a raid is live
export const MOOD_PEN_ALLY_DOWNED = 0.1; // an ally is downed (transient, decays)
export const MOOD_PEN_ALLY_DIED = 0.2; // an ally died (transient, decays)
// Comforts (added while the condition holds).
export const MOOD_COM_OWN_BED = 0.08;
export const MOOD_COM_FED_RESTED = 0.1;
export const MOOD_COM_FLOOR_ROOM = 0.05;
// Decay of the transient event-mood hit toward 0 (per real second).
export const EVENT_MOOD_DECAY = 1 / 12;

export const MOOD_SLOW = 0.3; // mood < this → work speed ×0.5, refuses priority-1 work
export const MOOD_SLOW_MUL = 0.5;
export const MOOD_BREAK = 0.15; // mood < this → idles ("wandering, upset") until it recovers

// ---- 3.4 Skills (settlers.md) --------------------------------------------------
// skillMul(0)=0.5×, skillMul(5)=0.95×, skillMul(10)=1.4×.
export function skillMul(level: number): number {
  return 0.5 + 0.09 * clampSkill(level);
}
export const SHOOT_HIT_PER_LEVEL = 0.03; // shooting skill adds this to base hit chance
export const SKILL_GROWTH = 0.02; // +level per completed job of that kind
export const SKILL_MAX = 10;
export const SKILL_DEFAULT = 3; // every unlisted skill starts here
export function clampSkill(level: number): number {
  return Math.max(0, Math.min(SKILL_MAX, level));
}

export interface SettlerArchetype {
  name: string;
  skills: Record<Skill, number>;
}
// Build a full skill sheet from the default, overriding the standouts / weaknesses.
function skills(overrides: Partial<Record<Skill, number>>): Record<Skill, number> {
  const out = {} as Record<Skill, number>;
  for (const s of SKILL_ORDER) out[s] = overrides[s] ?? SKILL_DEFAULT;
  return out;
}
// The three starters have distinct standout skills so they are NOT interchangeable.
export const SETTLER_ARCHETYPES: SettlerArchetype[] = [
  { name: "Mira", skills: skills({ mine: 6, build: 6, cook: 1 }) },
  { name: "Cole", skills: skills({ chop: 6, shoot: 6, farm: 1 }) },
  { name: "Sela", skills: skills({ cook: 6, farm: 6, shoot: 1 }) },
];

// ---- 3.5 Work times (s at 1.0× skill) & yields (economy.md, world.md) ----------
export const CHOP_TIME = 2.0;
export const CHOP_YIELD = 8; // wood dropped when a tree is cleared
export const MINE_TIME = 5.0;
export const MINE_YIELD = 6; // ore dropped when a vein is cleared
export const HAUL_PICKUP = 0.4; // s to pick a drop up (plus the walk)
export const COOK_TIME = 4.0;
export const COOK_IN = 4; // crops consumed per cook
export const COOK_OUT = 3; // meals produced per cook
export const SOW_TIME = 1.0;
export const HARVEST_TIME = 2.0;
export const HARVEST_YIELD = 6; // crops dropped from a ripe plot (resets it to sown)
export const TEND_TIME = 2.0; // s to stabilise a downed ally (plus the walk)

// The node's total work (its `hp`) is the base time; work accrues at time × skillMul.
export const CHOP_HP = CHOP_TIME;
export const MINE_HP = MINE_TIME;

// ---- 3.6 Structures — cost, build time, blocking (economy.md, README) ----------
export interface StructureDef {
  kind: StructureKind;
  name: string;
  cost: { wood: number; ore: number };
  buildTime: number; // s at 1.0× build skill
  blocksMove: boolean;
  cover: boolean; // gives cover to a shooter/target beside it
  blocksSight: boolean; // blocks line of sight and fire
  hp: number; // 0 = not damageable (raiders don't attack walls/doors in base)
}
export const STRUCTURES: Record<StructureKind, StructureDef> = {
  wall: { kind: "wall", name: "WALL", cost: { wood: 5, ore: 0 }, buildTime: 2.0, blocksMove: true, cover: true, blocksSight: true, hp: 120 },
  door: { kind: "door", name: "DOOR", cost: { wood: 8, ore: 0 }, buildTime: 2.0, blocksMove: false, cover: true, blocksSight: true, hp: 80 },
  floor: { kind: "floor", name: "FLOOR", cost: { wood: 2, ore: 0 }, buildTime: 1.0, blocksMove: false, cover: false, blocksSight: false, hp: 0 },
  bed: { kind: "bed", name: "BED", cost: { wood: 15, ore: 0 }, buildTime: 3.0, blocksMove: false, cover: false, blocksSight: false, hp: 0 },
  stove: { kind: "stove", name: "STOVE", cost: { wood: 25, ore: 5 }, buildTime: 5.0, blocksMove: true, cover: false, blocksSight: false, hp: 0 },
  farm: { kind: "farm", name: "FARM", cost: { wood: 6, ore: 0 }, buildTime: 2.0, blocksMove: false, cover: false, blocksSight: false, hp: 0 },
  turret: { kind: "turret", name: "TURRET", cost: { wood: 35, ore: 25 }, buildTime: 6.0, blocksMove: true, cover: true, blocksSight: true, hp: 140 },
};

export const FLOOR_MOVE_MUL = 1.15; // settlers move faster crossing a built floor
// Farm growth (fraction toward ripe per real second in daylight); grass beats soil.
export const FARM_GROW_SOIL = 1 / 55;
export const FARM_GROW_GRASS = 1 / 38;

// ---- 3.7 Combat (combat.md) ----------------------------------------------------
export const SETTLER_HEALTH = 100;
export const SETTLER_SPEED = 42; // px/s base walk speed
export const SETTLER_RANGE = 120;
export const SETTLER_FIRE_RATE = 0.9; // shots/s
export const SETTLER_DMG = 12;
export const SETTLER_BASE_HIT = 0.62;

export const TURRET_RANGE = 168;
export const TURRET_FIRE_RATE = 1.4;
export const TURRET_DMG = 10;
export const TURRET_HIT = 0.7;
export const TURRET_HP = 140;

export const RAIDER_HP_BASE = 40;
export const RAIDER_HP_PER_DAY = 3; // HP = 40 + 3·day
export const RAIDER_RANGE = 110;
export const RAIDER_FIRE_RATE = 0.8;
export const RAIDER_DMG = 10;
export const RAIDER_HIT = 0.55;
export const RAIDER_SPEED = 34;

export const COVER_MULT = 0.4; // incoming hit chance ×0.4 when the target is in cover
export const FALLOFF_NEAR = 0.5; // within 50% range → full accuracy
export const FALLOFF_FAR = 0.6; // multiplier at max range (lerps 1.0 → 0.6)
export const HIT_MIN = 0.05;
export const HIT_MAX = 0.95;

export const BLEED = 45; // s of bleed-out once downed
export const DOWNED_RECOVER_HP = 25; // hp a tended ally recovers to before rejoining
export const RAID_BREAK_FRAC = 0.6; // wave >=60% dead → survivors flee to nearest edge
export const TRACER_LIFE = 0.12; // s a shot's tracer is drawn (~120 ms)

export function raiderHp(day: number): number {
  return RAIDER_HP_BASE + RAIDER_HP_PER_DAY * day;
}
// Hit chance: base × range-falloff × cover, clamped. Shooting skill adds a flat bonus.
export function hitChance(base: number, dist: number, range: number, inCover: boolean, shootLevel = 0): number {
  const near = range * FALLOFF_NEAR;
  let falloff = 1;
  if (dist > near) falloff = 1 - (1 - FALLOFF_FAR) * ((dist - near) / (range - near));
  let p = base + SHOOT_HIT_PER_LEVEL * clampSkill(shootLevel);
  p *= falloff;
  if (inCover) p *= COVER_MULT;
  return Math.max(HIT_MIN, Math.min(HIT_MAX, p));
}

// ---- 3.8 Threat director (combat.md, DESIGN §3.8) ------------------------------
export const RAID_FIRST_DELAY = 2.0; // days — first raid lands early Day 3
export const RAID_NIGHT_BIAS = 0.7; // prob a would-be-daytime raid is nudged to dusk/night
export const RAID_ANNOUNCE_LEAD = 12; // s of warning banner + alarm before raiders spawn
export const RAID_SPAWN_POINTS_MAX = 2; // a wave splits across 1–2 edge points

// Interval (in days) after each raid, tightening as raids accumulate.
export function raidInterval(raidsSoFar: number): number {
  return Math.max(0.7, Math.min(1.6, 1.6 - 0.09 * raidsSoFar));
}

// Wealth W drives escalation (a richer colony draws bigger raids).
export const WEALTH_PER_SETTLER = 10;
export const STRUCTURE_WEALTH: Record<StructureKind, number> = {
  wall: 3,
  door: 4,
  floor: 1,
  bed: 8,
  stove: 20,
  farm: 6,
  turret: 40,
};
export const WEALTH_RES_WOOD_ORE = 0.5; // per wood+ore
export const WEALTH_CROPS = 1; // per crop
export const WEALTH_MEALS = 2; // per meal

// Threat points P from the day and wealth; raider count from P.
export function threatPoints(day: number, wealth: number): number {
  return 40 + 20 * day + 0.05 * wealth;
}
export function raiderCount(points: number): number {
  return Math.max(2, Math.min(24, Math.round(points / 28)));
}

// ---- 3.9 Palette (specs/overview.md, exactly) ----------------------------------
export const COL = {
  void: "#14110d",
  soil: "#5a4632",
  grass: "#6a7638",
  rock: "#38332c",
  tree: "#3f6b3a",
  ore: "#c9a24a",
  built: "#8a6a44",
  floor: "#4a3f30",
  settler: "#4f93c9",
  raider: "#c0473f",
  food: "#7cc45a",
  wood: "#b98b4e",
  health: "#e05a6a",
  alert: "#ff5a52",
  panel: "#1b1712",
  text: "#ece6db",
  text2: "#a89e8d",
  text3: "#6b6355",
} as const;

export const FONT = `"SF Mono", "JetBrains Mono", "Fira Mono", "DejaVu Sans Mono", "Menlo", "Consolas", monospace`;

// Settler helmet highlight (matches the produced settler sprite / the HUD settler glyph).
export const HELMET = "#cfe3f2";

// ---- Start config (DESIGN §2.4) ------------------------------------------------
// mode.ts exports MODE: StartConfig — the base "NEW COLONY" frontier start. Kept as a
// type here (the single vocabulary source); the concrete values live in mode.ts.
export interface StartConfig {
  crew: number; // 3 settlers
  stock: Stock; // { wood:120, ore:0, crops:0, meals:8 }
  mapSeed: number; // deterministic world-gen seed for the reference map
}
