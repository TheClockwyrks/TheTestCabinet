// Arc Foundry — fixed constants: the stage, palette, grid geometry, the component stat
// tables across the quality ladder, the scrap-press roll odds and combine recipe, the
// three maps, the Load roster and its per-wave HP scaling, the economy, and the
// difficulty table. Every number that specs/*.md pins lives here so the simulation reads
// exactly as written, and this is the single balance surface a later workflow tunes
// (specs/towers.md, specs/build.md, specs/enemies.md, specs/flow.md, specs/modes.md).
//
// The model (specs/overview.md): a GemTD reskin. A base component has a TYPE (one of eight
// firing/support identities) and a quality TIER (Scrap → Tesla-Prime); damage/range derive
// from base (Scrap) stats times the tier, fire rate flat across quality. Base towers are weak
// FEEDSTOCK — the payoff is assembling the twelve terminal COMBINATION TOWERS by recipe, which
// carry the exotic abilities (slow/burn/crit/multishot/aura). Every component, candidate, and
// blocker is a 2×2 wall; the Load mazes the shortest OPEN route through ordered waypoint
// platforms, never fully sealable.

import type {
  ComboType,
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
  choke: "#66d9e8", // slow (EM drag) — icy cyan
  rectifier: "#ff6b3d", // burn (overcurrent DoT) — ember orange
  regulator: "#b6e05a", // aura/support (non-firing) — lime
  combo: "#ffe9a8", // combination-tower accent (badge) — special gold
  blocker: "#3a4351", // inert fused-scrap rock (was "slag")
} as const;

export const FONT = `"SF Mono", "JetBrains Mono", "Fira Mono", "DejaVu Sans Mono", "Menlo", "Consolas", monospace`;

// ---- Component types (specs/towers.md) -----------------------------------------
// Eight base types: the five original firing identities plus Choke (slow), Rectifier
// (burn/DoT), and Regulator (a non-firing aura/support node).
export const COMPONENT_ORDER: ComponentType[] = [
  "capacitor",
  "coil",
  "emitter",
  "arcnode",
  "discharge",
  "choke",
  "rectifier",
  "regulator",
];

export const COMPONENT_LABEL: Record<ComponentType, string> = {
  capacitor: "CAPACITOR",
  coil: "COIL",
  emitter: "EMITTER",
  arcnode: "ARC-NODE",
  discharge: "DISCHARGE RIG",
  choke: "CHOKE",
  rectifier: "RECTIFIER",
  regulator: "REGULATOR",
};

// A one-to-two-sentence description of each component, shown in the inspector when a
// component or candidate is selected (specs/towers.md) so the player knows what it does.
// A plain description of what each component DOES (specs/towers.md), shown in the inspector.
// It states the component's behaviour and identity — not tactics or how to counter anything.
export const COMPONENT_DESC: Record<ComponentType, string> = {
  capacitor: "A balanced single-target bolt at a steady fire rate, medium range and damage.",
  coil: "Chain-lightning: its bolt leaps from the struck unit to nearby ones, each leap dealing less than the last.",
  emitter: "A rapid, low-damage spark at a very high fire rate and short range.",
  arcnode: "An area discharge: its shot detonates a ring that deals full damage to every unit near the impact point.",
  discharge: "A slow, long-range heavy bolt with the highest per-shot damage and the longest reach.",
  choke: "A single-target bolt that slows the struck unit for a moment on hit. Low direct damage.",
  rectifier: "A single-target bolt that lights an overcurrent burn — a damage-over-time that keeps ticking after the shot lands. Low direct damage.",
  regulator: "A non-firing support node. Every firing tower whose center is inside its aura deals more damage.",
};

export const COMPONENT_COLOR: Record<ComponentType, string> = {
  capacitor: COL.capacitor,
  coil: COL.coil,
  emitter: COL.emitter,
  arcnode: COL.arcnode,
  discharge: COL.discharge,
  choke: COL.choke,
  rectifier: COL.rectifier,
  regulator: COL.regulator,
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

// ---- Base (Scrap / T1) component stats (specs/towers.md) ------------------------
// Base towers are FEEDSTOCK — deliberately weak; the power comes from climbing the
// quality ladder and, above all, assembling COMBINATION TOWERS (below). `crit` and
// `multishot` are combo-only, so base types never carry them.
export interface ComponentDef {
  type: ComponentType;
  name: string;
  role: string; // one-line role (inspector)
  color: string;
  fires: boolean; // false for the Regulator (a non-firing aura node)
  range: number; // T1 range (px); 0 for the Regulator
  fireRate: number; // shots/sec — FLAT across quality; 0 for the Regulator
  dmg: number; // T1 base damage (× QUALITY_MULT for higher tiers); 0 for the Regulator
  splashT1: number; // Arc-Node: T1 splash radius (0 for the others)
  splashPerTier: number; // Arc-Node: +radius per tier above T1
  // Slow (Choke): each hit slows the unit's speed by `slowAmt` for `slowDur` s.
  slowAmt0?: number; // T1 slow fraction
  slowPerTier?: number; // + fraction per tier above T1
  slowDur?: number; // slow duration (s), flat across tiers
  // Burn (Rectifier): each hit applies DoT = burnFrac × shot-dmg per second for burnDur s.
  burnFrac?: number;
  burnDur?: number;
  // Aura (Regulator): buffs the damage of firing towers whose center lies within radius.
  auraRadius0?: number;
  auraRadiusPerTier?: number;
  auraBonus0?: number; // fractional damage bonus at T1
  auraBonusPerTier?: number;
}

export const COMPONENTS: Record<ComponentType, ComponentDef> = {
  capacitor: { type: "capacitor", name: "CAPACITOR", role: "Balanced single-target zap", color: COL.capacitor, fires: true, range: 100, fireRate: 1.6, dmg: 6, splashT1: 0, splashPerTier: 0 },
  coil: { type: "coil", name: "COIL", role: "Chain-lightning — leaps to nearby units", color: COL.coil, fires: true, range: 110, fireRate: 1.0, dmg: 5, splashT1: 0, splashPerTier: 0 },
  emitter: { type: "emitter", name: "EMITTER", role: "Rapid low-damage spark; anti-swarm", color: COL.emitter, fires: true, range: 88, fireRate: 4.5, dmg: 2, splashT1: 0, splashPerTier: 0 },
  arcnode: { type: "arcnode", name: "ARC-NODE", role: "Area discharge — damages everything near impact", color: COL.arcnode, fires: true, range: 96, fireRate: 0.85, dmg: 5, splashT1: 42, splashPerTier: 5 },
  discharge: { type: "discharge", name: "DISCHARGE RIG", role: "Slow, long-range heavy bolt; anti-tank", color: COL.discharge, fires: true, range: 160, fireRate: 0.5, dmg: 18, splashT1: 0, splashPerTier: 0 },
  choke: { type: "choke", name: "CHOKE", role: "Slows every unit it hits (EM drag)", color: COL.choke, fires: true, range: 104, fireRate: 1.3, dmg: 3, splashT1: 0, splashPerTier: 0, slowAmt0: 0.22, slowPerTier: 0.03, slowDur: 1.2 },
  rectifier: { type: "rectifier", name: "RECTIFIER", role: "Overcurrent burn — damage over time", color: COL.rectifier, fires: true, range: 96, fireRate: 1.1, dmg: 2, splashT1: 0, splashPerTier: 0, burnFrac: 0.5, burnDur: 2.0 },
  regulator: { type: "regulator", name: "REGULATOR", role: "Support aura — buffs nearby towers (does not fire)", color: COL.regulator, fires: false, range: 0, fireRate: 0, dmg: 0, splashT1: 0, splashPerTier: 0, auraRadius0: 90, auraRadiusPerTier: 6, auraBonus0: 0.1, auraBonusPerTier: 0.03 },
};

// Coil chain (specs/towers.md): the bolt leaps to the nearest not-yet-hit unit within
// CHAIN_RANGE, each leap dealing ×CHAIN_FALLOFF of the previous. Max ADDITIONAL leaps by
// tier: 2 (T1–T2), 3 (T3–T4), 4 (Tesla-Prime).
export const COIL_CHAIN_RANGE = 70;
export const COIL_CHAIN_FALLOFF = 0.7;
export function coilLeaps(tier: Tier): number {
  return tier >= 5 ? 4 : tier >= 3 ? 3 : 2;
}

// Aura buffs stack additively but are capped so a wall of Regulators cannot run away.
export const AURA_BONUS_CAP = 1.0; // +100% max total external aura on any one tower

// Projectile travel speed by component (logical px/s). A shot is a real travelling
// projectile that deals its effect on impact, not a hitscan (specs/towers.md). The
// non-firing Regulator launches none (0 is a placeholder to satisfy the record).
export const PROJECTILE_SPEED: Record<ComponentType, number> = {
  capacitor: 560,
  coil: 640,
  emitter: 680,
  arcnode: 460,
  discharge: 760,
  choke: 600,
  rectifier: 560,
  regulator: 0,
};
export const COMBO_PROJECTILE_SPEED = 620; // combination towers share one travel speed

// ---- Derived effective stats (the single source, specs/towers.md) --------------
// The complete live behaviour of ANY firing tower — base component OR combination tower —
// reduces to a CompStats. `deriveStats(type,tier)` builds one for a base component;
// `comboStats(combo)` (below) builds one for a combination tower.
export interface CompStats {
  fires: boolean;
  range: number;
  fireRate: number;
  dmg: number; // per shot (before external aura)
  splash: number; // area radius (0 = single target)
  chainLeaps: number; // extra chain leaps (0 = no chain)
  chainRange: number;
  chainFalloff: number;
  slowAmt: number; // fraction of speed removed on hit (0 = no slow)
  slowDur: number;
  burnFrac: number; // DoT-per-second as a fraction of the shot's dmg (0 = no burn)
  burnDur: number;
  critChance: number; // 0..1 (combo-only)
  critMult: number; // ×dmg on a crit
  multishot: number; // distinct simultaneous targets per cadence (1 = single)
  auraRadius: number; // this tower's own aura radius (0 = no aura)
  auraBonus: number; // this tower's own aura damage bonus
}

const EMPTY_ABILITIES = {
  slowAmt: 0,
  slowDur: 0,
  burnFrac: 0,
  burnDur: 0,
  critChance: 0,
  critMult: 1,
  multishot: 1,
  auraRadius: 0,
  auraBonus: 0,
} as const;

// A base component's live behaviour is fully derived from (type, tier).
export function deriveStats(type: ComponentType, tier: Tier): CompStats {
  const def = COMPONENTS[type];
  const mult = QUALITY_MULT[tier]!;
  return {
    ...EMPTY_ABILITIES,
    fires: def.fires,
    range: def.fires ? def.range + RANGE_PER_TIER * (tier - 1) : 0,
    fireRate: def.fireRate, // flat across quality
    dmg: Math.round(def.dmg * mult),
    splash: def.splashT1 > 0 ? def.splashT1 + def.splashPerTier * (tier - 1) : 0,
    chainLeaps: type === "coil" ? coilLeaps(tier) : 0,
    chainRange: COIL_CHAIN_RANGE,
    chainFalloff: COIL_CHAIN_FALLOFF,
    slowAmt: def.slowAmt0 ? def.slowAmt0 + (def.slowPerTier ?? 0) * (tier - 1) : 0,
    slowDur: def.slowDur ?? 0,
    burnFrac: def.burnFrac ?? 0,
    burnDur: def.burnDur ?? 0,
    auraRadius: def.auraRadius0 ? def.auraRadius0 + (def.auraRadiusPerTier ?? 0) * (tier - 1) : 0,
    auraBonus: def.auraBonus0 ? def.auraBonus0 + (def.auraBonusPerTier ?? 0) * (tier - 1) : 0,
  };
}

// ---- Combination towers (specs/towers.md, specs/build.md) ----------------------
// Assembled by a RECIPE — a specific multiset of base (type, quality) ingredients folds
// into one unique combination tower. Single-grade + terminal (no quality tier, cannot
// quality-combine, cannot be an ingredient). Each carries its own fixed stat block and
// ability mix. Recipe tiers span all-Scrap (early, accessible) to Tesla-gated (apex), so
// combining is a strategic gate throughout the run, not just an endgame flourish.
export interface RecipeIngredient {
  type: ComponentType;
  tier: Tier;
}

export interface ComboDef {
  combo: ComboType;
  name: string;
  desc: string;
  color: string;
  recipe: RecipeIngredient[]; // the exact ingredient multiset (order irrelevant)
  range: number;
  fireRate: number;
  dmg: number;
  splash: number;
  chainLeaps: number;
  chainRange: number;
  chainFalloff: number;
  slowAmt: number;
  slowDur: number;
  burnFrac: number;
  burnDur: number;
  critChance: number;
  critMult: number;
  multishot: number;
  auraRadius: number;
  auraBonus: number;
}

// Shorthand for a recipe ingredient (type at a tier).
function ing(type: ComponentType, tier: Tier): RecipeIngredient {
  return { type, tier };
}

// Ability-field defaults so each combo only lists what it actually carries.
type ComboSpec = Partial<Omit<ComboDef, "combo" | "name" | "desc" | "color" | "recipe" | "range" | "fireRate" | "dmg">>;
function combo(
  combo: ComboType,
  name: string,
  color: string,
  recipe: RecipeIngredient[],
  range: number,
  fireRate: number,
  dmg: number,
  abilities: ComboSpec,
  desc: string,
): ComboDef {
  return {
    combo,
    name,
    desc,
    color,
    recipe,
    range,
    fireRate,
    dmg,
    splash: abilities.splash ?? 0,
    chainLeaps: abilities.chainLeaps ?? 0,
    chainRange: abilities.chainRange ?? COIL_CHAIN_RANGE,
    chainFalloff: abilities.chainFalloff ?? COIL_CHAIN_FALLOFF,
    slowAmt: abilities.slowAmt ?? 0,
    slowDur: abilities.slowDur ?? 0,
    burnFrac: abilities.burnFrac ?? 0,
    burnDur: abilities.burnDur ?? 0,
    critChance: abilities.critChance ?? 0,
    critMult: abilities.critMult ?? 1,
    multishot: abilities.multishot ?? 1,
    auraRadius: abilities.auraRadius ?? 0,
    auraBonus: abilities.auraBonus ?? 0,
  };
}

export const COMBOS: Record<ComboType, ComboDef> = {
  fusecluster: combo("fusecluster", "FUSE CLUSTER", COL.arcnode, [ing("regulator", 1), ing("rectifier", 1), ing("arcnode", 1)], 108, 1.0, 40, { splash: 55, burnFrac: 0.4, burnDur: 2 }, "A splash tower that also lights a burn on the units it hits. Built from all-Scrap ingredients."),
  staticweb: combo("staticweb", "STATIC WEB", COL.coil, [ing("coil", 1), ing("capacitor", 1), ing("choke", 1)], 120, 1.2, 34, { chainLeaps: 3, chainRange: 80, chainFalloff: 0.75, slowAmt: 0.25, slowDur: 1.2 }, "A chaining bolt that slows every unit it forks through."),
  slagdriver: combo("slagdriver", "SLAG DRIVER", COL.discharge, [ing("discharge", 2), ing("discharge", 1), ing("emitter", 1)], 175, 0.6, 120, { critChance: 0.25, critMult: 2.0 }, "A long-range heavy bolt that sometimes lands a crushing critical hit."),
  corroder: combo("corroder", "CORRODER", COL.rectifier, [ing("rectifier", 3), ing("regulator", 3), ing("choke", 2)], 110, 1.1, 30, { burnFrac: 0.6, burnDur: 3, slowAmt: 0.2, slowDur: 1.0, auraRadius: 80, auraBonus: 0.1 }, "Burns and slows what it hits, and projects a damage aura over nearby towers."),
  ionprism: combo("ionprism", "ION PRISM", COL.rectifier, [ing("discharge", 3), ing("rectifier", 4), ing("emitter", 2)], 140, 0.9, 90, { splash: 50, burnFrac: 0.5, burnDur: 2, critChance: 0.2, critMult: 1.8 }, "A splash bolt that burns on impact and can land a critical hit."),
  forkarray: combo("forkarray", "FORK ARRAY", COL.emitter, [ing("emitter", 3), ing("capacitor", 3), ing("coil", 2)], 118, 1.8, 55, { multishot: 3 }, "A rapid array that fires at three separate targets at once."),
  nullcore: combo("nullcore", "NULL CORE", COL.regulator, [ing("regulator", 5), ing("capacitor", 4), ing("arcnode", 3)], 120, 1.0, 70, { splash: 55, auraRadius: 100, auraBonus: 0.2 }, "A splash core wrapped in a strong damage aura that buffs nearby towers."),
  rupturenode: combo("rupturenode", "RUPTURE NODE", COL.arcnode, [ing("discharge", 5), ing("arcnode", 4), ing("emitter", 3)], 150, 0.7, 180, { splash: 60, burnFrac: 0.5, burnDur: 2 }, "A heavy shot that detonates a large burning splash on impact."),
  blightcoil: combo("blightcoil", "BLIGHT COIL", COL.rectifier, [ing("rectifier", 5), ing("choke", 4), ing("coil", 2)], 128, 1.1, 80, { chainLeaps: 3, chainRange: 80, chainFalloff: 0.7, burnFrac: 0.6, burnDur: 3, slowAmt: 0.3, slowDur: 1.5 }, "A chaining bolt that both slows and burns everything it forks through."),
  reactorpile: combo("reactorpile", "REACTOR PILE", COL.coil, [ing("coil", 5), ing("choke", 3), ing("regulator", 2)], 130, 1.4, 90, { chainLeaps: 4, chainRange: 85, chainFalloff: 0.75, multishot: 2 }, "Fires two heavy chain-lightning bolts at once, each forking through the pack."),
  auroralance: combo("auroralance", "AURORA LANCE", COL.choke, [ing("choke", 5), ing("coil", 4), ing("discharge", 4)], 190, 0.7, 260, { chainLeaps: 2, chainRange: 75, chainFalloff: 0.6, slowAmt: 0.4, slowDur: 1.8 }, "An apex lance: enormous reach and per-hit damage, a hard slow, and a chaining strike."),
  singularity: combo("singularity", "SINGULARITY", COL.combo, [ing("arcnode", 5), ing("regulator", 4), ing("rectifier", 2), ing("arcnode", 2)], 150, 1.0, 320, { splash: 65, burnFrac: 0.6, burnDur: 2.5, critChance: 0.3, critMult: 2.2, auraRadius: 90, auraBonus: 0.15 }, "The apex: splash, burn, critical hits, and a damage aura in one tower."),
};

export const COMBO_ORDER: ComboType[] = [
  "fusecluster",
  "staticweb",
  "slagdriver",
  "corroder",
  "ionprism",
  "forkarray",
  "nullcore",
  "rupturenode",
  "blightcoil",
  "reactorpile",
  "auroralance",
  "singularity",
];

// ---- Combination-tower UPGRADES (specs/towers.md, specs/build.md) --------------
// A combination tower is NO LONGER a single fixed block. To SOFTEN the power spike when a
// combo lands and to give kill income a real SINK, a combo carries an UPGRADE LEVEL 0..3:
//   • a recipe-combine LANDS the combo at level 0 — a REDUCED fraction of its reference block
//     (COMBO_LEVEL_DMG_MULT[0]), so assembling it is a step up but not a cliff;
//   • each UPGRADE (build-phase, spends Charge) raises the level, scaling DAMAGE (which
//     cascades through burn/crit/splash/chain, all damage-derived) and nudging RANGE, up to
//     level 3 ≈ 1.12× the reference (slightly past the old fixed block).
// The COMBOS[c] block is the REFERENCE (the ~level-2/3 target); levels scale around it. Fire
// rate and the ability structure (splash radius, chain leaps, slow/burn/crit params, aura) are
// flat across level — only raw damage and range climb, since damage carries every ability.
export const MAX_COMBO_LEVEL = 3;
export const COMBO_LEVEL_DMG_MULT: number[] = [0.5, 0.63, 0.78, 1.02]; // index = level 0..3
export const COMBO_LEVEL_RANGE_ADD: number[] = [0, 4, 8, 12]; // + range px by level

// Cost to REACH each combo level (1..3) from the one below, as a fraction of the combo's
// reference damage — so a stronger combo costs more to upgrade (the apex is the deepest sink).
// Index 0 unused (a combo lands at level 0 for free via the recipe). e.g. a dmg-40 early combo
// costs 24/40/72 to max; a dmg-320 apex costs 192/320/576.
export const COMBO_UPGRADE_COST_FRAC: number[] = [0, 0.8, 1.5, 2.8];

// The Charge cost to raise combo `c` from `level` to `level+1`, or null at MAX_COMBO_LEVEL.
export function comboUpgradeCost(c: ComboType, level: number): number | null {
  if (level >= MAX_COMBO_LEVEL) return null;
  return Math.round(COMBOS[c].dmg * COMBO_UPGRADE_COST_FRAC[level + 1]!);
}

// A combination tower's live stats at a given UPGRADE LEVEL (fires: true always; no quality
// tier — the level, not a tier, is its power axis). Damage scales by COMBO_LEVEL_DMG_MULT and
// range by COMBO_LEVEL_RANGE_ADD; every ability is damage-derived, so it scales with the level
// through `dmg`.
export function comboStats(c: ComboType, level = 0): CompStats {
  const d = COMBOS[c];
  const lvl = Math.max(0, Math.min(MAX_COMBO_LEVEL, level));
  return {
    fires: true,
    range: d.range + COMBO_LEVEL_RANGE_ADD[lvl]!,
    fireRate: d.fireRate,
    dmg: Math.round(d.dmg * COMBO_LEVEL_DMG_MULT[lvl]!),
    splash: d.splash,
    chainLeaps: d.chainLeaps,
    chainRange: d.chainRange,
    chainFalloff: d.chainFalloff,
    slowAmt: d.slowAmt,
    slowDur: d.slowDur,
    burnFrac: d.burnFrac,
    burnDur: d.burnDur,
    critChance: d.critChance,
    critMult: d.critMult,
    multishot: d.multishot,
    auraRadius: d.auraRadius,
    auraBonus: d.auraBonus,
  };
}

// The multiset key of a recipe (sorted "type@tier" tokens) — used to match an assembled
// set of ingredients against a combo recipe.
export function recipeKey(ings: RecipeIngredient[]): string {
  return ings
    .map((i) => `${i.type}@${i.tier}`)
    .sort()
    .join(",");
}

// combo recipe → its multiset key, precomputed for matching.
export const RECIPE_INDEX: Map<string, ComboType> = new Map(
  COMBO_ORDER.map((c) => [recipeKey(COMBOS[c].recipe), c] as const),
);

// ---- The scrap-press build loop (specs/build.md) -------------------------------
// GemTD-faithful: place up to BUILDS_PER_LEVEL rocks a level, keep exactly one, the rest
// harden into blockers. The ROLL happens on placement, not on the STAMP click.
export const BUILDS_PER_LEVEL = 5; // fixed 5-stamp allowance per level (hard cap, constant across difficulty)
export const STAMP_COST = 10; // Charge to place one rock (capped at 5 placements/level regardless of Charge)

// Type roll: uniform 12.5% each across the eight types (specs/build.md). Independent of
// Refinement.
export const STAMP_TYPE_WEIGHT: Record<ComponentType, number> = {
  capacitor: 0.125,
  coil: 0.125,
  emitter: 0.125,
  arcnode: 0.125,
  discharge: 0.125,
  choke: 0.125,
  rectifier: 0.125,
  regulator: 0.125,
};

// Quality roll by Refinement level R (specs/build.md — UPGRADE QUALITY). Each row is a
// 5-tier distribution [T1..T5] that sums to 1.0; higher R biases upward. Indexed R = 0..5.
// GemTD-faithful: at R0 the press rolls ONLY Scrap (T1) — every higher quality is earned by
// refining the press, and Primed/Tesla-Prime (T4/T5) are always combine-only (columns 0).
export const QUALITY_ODDS_BY_R: number[][] = [
  [1.0, 0.0, 0.0, 0.0, 0.0], //   R0 (100% Scrap — the GemTD level-1 roll)
  [0.8, 0.2, 0.0, 0.0, 0.0], //   R1
  [0.62, 0.32, 0.06, 0.0, 0.0], // R2
  [0.46, 0.4, 0.14, 0.0, 0.0], //  R3
  [0.32, 0.44, 0.24, 0.0, 0.0], // R4
  [0.2, 0.45, 0.35, 0.0, 0.0], //  R5
];

// Legacy alias: the R0 quality distribution as a tier-indexed array (index 0 unused), so
// any older reference keeps working. Prefer QUALITY_ODDS_BY_R[r].
export const STAMP_QUALITY_WEIGHT: number[] = [0, ...QUALITY_ODDS_BY_R[0]!];

export const MAX_REFINEMENT: Refinement = 5;

// UPGRADE QUALITY cost to REACH each Refinement level (from the previous), Charge.
// Indexed by target level; index 0 unused (you start at R0). specs/build.md.
export const REFINE_COST: number[] = [0, 60, 130, 240, 400, 620];

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

// Bounties are on the GemTD SCALE (specs/enemies.md, specs/flow.md): a wave-1 basic unit pays
// ~1 Charge, not the old ~3, so gold is SCARCE and every stamp is a real decision (the old
// bounties made Charge almost free). Integer-only — a basic unit pays 1, and the rest scale
// around it: a tanky Slug 3, a flyer 2, the Dynamo boss 40. Kill income is deliberately thin;
// the only other income is a small wave-clear bonus (there is no interest, specs/flow.md).
export const LOAD: Record<LoadType, LoadDef> = {
  mote: { type: "mote", label: "MOTE", baseHp: 44, speed: 60, flies: false, bounty: 1, leak: 1, radius: 10, boss: false },
  spark: { type: "spark", label: "SPARK", baseHp: 27, speed: 120, flies: false, bounty: 1, leak: 1, radius: 8, boss: false },
  slug: { type: "slug", label: "SLUG", baseHp: 180, speed: 38, flies: false, bounty: 3, leak: 2, radius: 13, boss: false },
  cluster: { type: "cluster", label: "CLUSTER", baseHp: 16, speed: 72, flies: false, bounty: 1, leak: 1, radius: 7, boss: false },
  filament: { type: "filament", label: "FILAMENT", baseHp: 74, speed: 85, flies: true, bounty: 2, leak: 1, radius: 9, boss: false },
  dynamo: { type: "dynamo", label: "DYNAMO", baseHp: 1500, speed: 30, flies: false, bounty: 40, leak: 5, radius: 20, boss: true },
};

export const LOAD_ORDER: LoadType[] = ["mote", "spark", "slug", "cluster", "filament", "dynamo"];

// A one-line description of each Load type (specs/enemies.md), shown as a tooltip when the
// player hovers a unit's name in the next-wave panel so they know what they are facing.
// A plain description of what each Load type IS (specs/enemies.md), shown as a hover tooltip in
// the next-wave preview. It states the unit's defining traits — not how to counter it.
export const LOAD_DESC: Record<LoadType, string> = {
  mote: "The baseline charge unit: average health and speed.",
  spark: "Fast and fragile — about half a Mote's health at double the speed.",
  slug: "A slow, capacitive tank with a huge health pool; costs 2 Grid Integrity if it grounds out.",
  cluster: "Tiny and low-health, but arrives in dense packs of many units at once.",
  filament: "The flyer: ignores the maze and flies in a straight line over your walls. Appears only every 4th wave.",
  dynamo: "The boss: a massive health pool that costs 5 Grid Integrity if it grounds out. Anchors the milestone waves.",
};

// Per-wave HP scaling (specs/enemies.md §7.1): HP(w) = baseHP × baseMult × (1 + k·(w−1)).
// baseMult and k are set by difficulty; only HP grows — speeds, bounties, leaks are fixed.
export function scaledHp(baseHp: number, wave: number, baseMult: number, k: number): number {
  return Math.round(baseHp * baseMult * (1 + k * (wave - 1)));
}

// ---- Economy (specs/flow.md — constant across difficulty) ----------------------
// Every build phase is UNTIMED (specs/flow.md): no countdown and no early-send bonus.
// Charge is spent on placing rocks (STAMP_COST), UPGRADE QUALITY (REFINE_COST), and
// UPGRADING COMBINATION TOWERS (comboUpgradeCost) — there is no selling or slagging.
//
// Charge is deliberately SCARCE, GemTD-style: bounties are thin (LOAD above), there is NO
// INTEREST, and the wave-clear bonus is small — it starts at ~10 Charge on Wave 1 (like GemTD)
// and grows only gently. So every stamp, refine, and combo upgrade is a real decision, and a
// player cannot flood the board.
export const START_CHARGE = 130;
export const START_INTEGRITY = 20;

// The flat Charge paid for clearing a wave: ~10 on Wave 1, growing gently (+2 per wave).
export function waveClearBonus(wave: number): number {
  return 8 + 2 * wave;
}

// ---- Maze rating (specs/flow.md) -----------------------------------------------
// The run keeps NO running score. Its one end-of-run number is the MAZE RATING: the total
// damage the player's maze deals to the post-final invincible Overload Dynamo on its single
// walk through the maze (specs/enemies.md, specs/flow.md). Grid Integrity only decides
// win/lose, never score. A defeat has no rating (the finale is never reached).

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
  easy: { key: "easy", label: "EASY", waves: 40, baseMult: 0.2, k: 0.5, milestones: [20, 40], note: "A shorter siege with the gentlest HP ramp." },
  medium: { key: "medium", label: "MEDIUM", waves: 50, baseMult: 0.22, k: 1.17, milestones: [25, 50], note: "The reference balance — a true GemTD-length campaign." },
  hard: { key: "hard", label: "HARD", waves: 60, baseMult: 0.24, k: 1.3, milestones: [30, 60], note: "A long siege with the steepest HP climb." },
};

export const DIFFICULTY_ORDER: Difficulty[] = ["easy", "medium", "hard"];

// A wave carries a Dynamo boss if it is a milestone wave (specs/flow.md §9.1).
export function isMilestoneWave(wave: number, diff: DifficultyDef): boolean {
  return diff.milestones.includes(wave);
}

// ---- The three maps (specs/board.md §4 — tile coordinates) ---------------------
// Every map plays the same campaign; only the topology (waypoint placement and Map C's
// fixed housings) differs. The pathing chain is [entry, ...waypoints, collector].

// Every waypoint anchor sits ≥4 tiles inset from every edge (cols 4..45, rows 4..28). A
// platform's side arm sits one tile off the anchor, so the OUTER gap between the arm and
// the edge is (inset − 1) ≥ 3 tiles — enough to build a 2×2 wall there AND keep a 1-tile
// pass lane, so the maze can wrap the route around a waypoint's far side, not just its
// inner side (specs/board.md). Each map now runs SIX waypoints (a longer, loopier route),
// so mazing matters far more.

// Map A — "The Substation": a perimeter spiral serpentine (six long legs) that folds
// inward then exits right.
const SUBSTATION: MapDef = {
  id: "substation",
  name: "The Substation",
  blurb: "A perimeter spiral — fold the route down the edges, then in through the center to the right-side sink.",
  styleLabel: "SERPENTINE",
  entry: { col: 0, row: 5 },
  entryEdge: "left",
  waypoints: [
    { col: 44, row: 5 },
    { col: 44, row: 27 },
    { col: 5, row: 27 },
    { col: 5, row: 14 },
    { col: 36, row: 14 },
    { col: 36, row: 20 },
  ],
  collector: { col: 49, row: 20 },
  collectorEdge: "right",
  housings: [],
};

// Map B — "The Switchyard": a crossing star whose six legs criss-cross the center band.
const SWITCHYARD: MapDef = {
  id: "switchyard",
  name: "The Switchyard",
  blurb: "A crossing star — six legs cut back and forth through the middle, so the center band is the premium maze.",
  styleLabel: "BUSBAR",
  entry: { col: 25, row: 0 },
  entryEdge: "top",
  waypoints: [
    { col: 5, row: 26 },
    { col: 44, row: 6 },
    { col: 5, row: 6 },
    { col: 44, row: 26 },
    { col: 24, row: 16 },
    { col: 5, row: 16 },
  ],
  collector: { col: 25, row: 32 },
  collectorEdge: "bottom",
  housings: [],
};

// Map C — "The Transformer Yard": two fixed housings split the yard; WP2 threads the gap.
const TRANSFORMER: MapDef = {
  id: "transformer",
  name: "The Transformer Yard",
  blurb: "Two fixed transformer housings split the yard; the center waypoint threads the gap as the route loops the corridors.",
  styleLabel: "CHOKEPOINT",
  entry: { col: 0, row: 2 },
  entryEdge: "left",
  waypoints: [
    { col: 44, row: 5 },
    { col: 24, row: 16 },
    { col: 44, row: 28 },
    { col: 24, row: 28 },
    { col: 6, row: 28 },
    { col: 6, row: 16 },
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
