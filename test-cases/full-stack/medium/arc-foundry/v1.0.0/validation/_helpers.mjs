// Case-specific helpers for Arc Foundry's automated-validation debug scripts.
//
// Every script drives the REAL, deterministic simulation through window.__foundry
// (see specs/instrumentation.md): control ops only ESTABLISH preconditions — a
// placed rock rolls through the real press, a kept candidate harvests through the
// real path, a combine resolves through the real combine code, a spawned unit walks
// the real pathfinder — and the observed result always comes from stepping the real
// simulation forward and reading `snapshot()` (or the rendered pixels). Nothing
// fabricates an outcome. These helpers factor out the common "arrange the board,
// step the real sim, read what happened" patterns and the fixed geometry/constants
// the scripts depend on (mirrored from specs/*.md and the canonical constants).
//
// The assertion primitives themselves are NOT here — they are the reporter-side
// `ttc` kit the driver hands every `drive(api, ttc)` (packages/browser-driver/ttc.mjs),
// shared by every case. This file holds only what is specific to Arc Foundry.
//
// THE MANUAL CLOCK (specs/instrumentation.md). `reset()` and `step()` put the sim
// under the driver's clock (autoStep off), so `step(dt)` advances EXACTLY `dt` of
// game time and a measurement is exact and reproducible regardless of machine load.
// Scripts therefore MEASURE in the default manual mode and assert exact values (only
// tight float tolerances). For a motion video CLIP a script calls setAutoStep(true)
// before a real-time api.wait(...) so the recorded clip shows the board in motion.

// ---- Stage + grid geometry (specs/board.md, specs/overview.md) -----------------
export const STAGE_W = 1280;
export const STAGE_H = 720;
export const STATUS_H = 56; // top status bar; the board grid is anchored at (0, 56)
export const TILE = 20; // 20 px tiles
export const GRID_COLS = 50;
export const GRID_ROWS = 33;
export const FIXED = 1 / 60; // the fixed simulation timestep (matches FIXED_STEP)

// A tile's center in logical-pixel space.
export function tileCenter(col, row) {
  return { x: TILE * col + TILE / 2, y: STATUS_H + TILE * row + TILE / 2 };
}
// A 2x2 footprint's center (used for range, targeting, drawing): (20*(col+1), 56+20*(row+1)).
export function footprintCenter(col, row) {
  return { x: TILE * (col + 1), y: STATUS_H + TILE * (row + 1) };
}

// ---- Economy / balance constants (constants.ts, specs/flow.md) -----------------
export const START_CHARGE = 10;
export const START_INTEGRITY = 20;
export const BUILDS_PER_LEVEL = 5;
export function waveClearBonus(wave) {
  return 8 + 2 * wave;
}
// Quality ladder: damage multiplier by tier (index 0 unused), range per tier, flat rate.
export const QUALITY_MULT = [0, 1.0, 3.0, 9.0, 40, 110];
export const RANGE_PER_TIER = 8;
export const MAX_TIER = 5;
export const MAX_REFINEMENT = 8;
// UPGRADE QUALITY cost to REACH each Refinement level (index = target level; 0 unused).
export const REFINE_COST = [0, 20, 50, 80, 110, 140, 170, 200, 230];
// The quality-roll distribution [T1..T5] at each Refinement level R (0..8), each summing to 1.
export const QUALITY_ODDS_BY_R = [
  [1.0, 0.0, 0.0, 0.0, 0.0],
  [0.7, 0.3, 0.0, 0.0, 0.0],
  [0.6, 0.3, 0.1, 0.0, 0.0],
  [0.5, 0.3, 0.2, 0.0, 0.0],
  [0.4, 0.3, 0.2, 0.1, 0.0],
  [0.3, 0.3, 0.3, 0.1, 0.0],
  [0.2, 0.3, 0.3, 0.2, 0.0],
  [0.1, 0.3, 0.3, 0.3, 0.0],
  [0.0, 0.3, 0.3, 0.3, 0.1],
];

// Base (Scrap / T1) component stats we assert against (constants.ts COMPONENTS).
export const BASE = {
  capacitor: { dmg: 6, range: 100, fireRate: 1.6 },
  coil: { dmg: 5, range: 110, fireRate: 1.0 },
  emitter: { dmg: 2, range: 88, fireRate: 4.5 },
  arcnode: { dmg: 5, range: 96, fireRate: 0.85 },
  discharge: { dmg: 18, range: 160, fireRate: 0.5 },
  choke: { dmg: 3, range: 104, fireRate: 1.3, slowAmt0: 0.22, slowPerTier: 0.03, slowDur: 1.2 },
  rectifier: { dmg: 2, range: 96, fireRate: 1.1, burnFrac: 0.5, burnDur: 2.0 },
  regulator: { dmg: 0, range: 0, fireRate: 0, auraRadius0: 90, auraBonus0: 0.1 },
};

// The Load roster base (Wave-1, Medium) stats (constants.ts LOAD, specs/enemies.md §7).
export const LOAD = {
  mote: { baseHp: 44, speed: 60, flies: false, bounty: 1, leak: 1 },
  spark: { baseHp: 27, speed: 120, flies: false, bounty: 1, leak: 1 },
  slug: { baseHp: 180, speed: 38, flies: false, bounty: 3, leak: 2 },
  cluster: { baseHp: 16, speed: 72, flies: false, bounty: 1, leak: 1 },
  filament: { baseHp: 74, speed: 85, flies: true, bounty: 2, leak: 1 },
  dynamo: { baseHp: 1500, speed: 30, flies: false, bounty: 40, leak: 5 },
};

// The difficulty table (constants.ts DIFFICULTY, specs/modes.md §9.2): wave count + toughness.
export const DIFFICULTY = {
  easy: { waves: 40, baseMult: 0.2, k: 0.5, surchargeC: 0.08, surchargeR: 1.09 },
  medium: { waves: 50, baseMult: 0.22, k: 1.17, surchargeC: 0.18, surchargeR: 1.13 },
  hard: { waves: 60, baseMult: 0.24, k: 1.3, surchargeC: 0.18, surchargeR: 1.14 },
};

// Per-wave HP scaling (constants.ts scaledHp, specs/enemies.md §7.1): the current linear
// ramp plus a late-game exponential surcharge (~0 in the opening/mid waves). Only HP grows.
export function scaledHp(baseHp, wave, diffKey = "medium") {
  const d = DIFFICULTY[diffKey];
  const linear = 1 + d.k * (wave - 1);
  const surcharge = d.surchargeC * (Math.pow(d.surchargeR, wave - 1) - 1);
  return Math.round(baseHp * d.baseMult * (linear + surcharge));
}

// A few combination-tower recipes used by the combo/ability scripts (constants.ts COMBOS).
// Each is the exact (type, tier) ingredient multiset a recipe-combine folds.
export const RECIPES = {
  fusecluster: [["regulator", 1], ["rectifier", 1], ["arcnode", 1]], // all-Scrap early combo
  forkarray: [["emitter", 3], ["capacitor", 3], ["coil", 2]], // multishot 3
  slagdriver: [["discharge", 2], ["discharge", 1], ["emitter", 1]], // crit
};

// ---- The standard entry-adjacent tower spot (substation) -----------------------
// On the default "substation" map the Entry is tile (0,5) — center (10,166) — and the
// Load walks right along row 5 toward WP1 (44,5). A 2x2 tower anchored at (2,7) has its
// center at (60,216): the Entry itself is within ~71px of it (inside every firing type's
// range) and the tower sits BELOW the row-5 corridor, so it never blocks the path. A unit
// spawned at the Entry is therefore in range immediately, so a firing check resolves well
// inside the first 0.6 s — before the kept level's own Wave 1 begins releasing units
// (its first spawn is at 600 ms), keeping a driven combat measurement uncontaminated.
export const ENTRY = { col: 0, row: 5 };
export const ENTRY_C = tileCenter(0, 5); // { x: 10, y: 166 }
export const TOWER = { col: 2, row: 7 };
export const TOWER_C = footprintCenter(2, 7); // { x: 60, y: 216 }
// A few more legal, non-sealing anchors in the open lower-left yard for extra pieces.
export const SPOTS = [
  { col: 2, row: 7 },
  { col: 2, row: 10 },
  { col: 6, row: 7 },
  { col: 6, row: 10 },
  { col: 10, row: 7 },
];

// ---- Core drive helpers --------------------------------------------------------

/** A snapshot shorthand. */
export async function snap(api) {
  return api.snapshot();
}

/**
 * Advance the real simulation in fixed-step chunks until `predicate(snapshot)` holds,
 * or until `maxSeconds` of game time elapse. Returns `{ snap, hit, steps }`. Pass a
 * coarse `chunk` when the quantity read is constant between events (a long traverse), or
 * FIXED (one step) to read state the instant something happens.
 */
export async function stepUntil(api, predicate, maxSeconds, chunk = FIXED) {
  let s = await api.snapshot();
  if (predicate(s)) return { snap: s, hit: true, steps: 0 };
  const iters = Math.ceil(maxSeconds / chunk);
  for (let i = 0; i < iters; i += 1) {
    await api.step(chunk);
    s = await api.snapshot();
    if (predicate(s)) return { snap: s, hit: true, steps: i + 1 };
  }
  return { snap: s, hit: false, steps: iters };
}

/**
 * Reset (reseeding all randomness) and begin a run at its opening build phase. `charge`
 * optionally overrides the starting Charge as a precondition for an upgrade. Returns the
 * opening snapshot.
 */
export async function startBuild(api, { seed = 1, map = "substation", difficulty = "medium", charge } = {}) {
  await api.reset({ seed });
  await api.call("startRun", { map, difficulty });
  if (charge != null) await api.call("setCharge", charge);
  return api.snapshot();
}

/**
 * Arm the exact roll and drop a rock at (col,row) through the real placement path, landing
 * a candidate. Returns the placed candidate's snapshot entry, or null if the drop was
 * refused (illegal footprint).
 */
export async function placeCandidate(api, type, tier, col, row) {
  await api.call("setNextRoll", type, tier);
  await api.call("placeRock", col, row);
  const s = await api.snapshot();
  return s.towers.find((t) => t.col === col && t.row === row && t.kind === "candidate") ?? null;
}

/**
 * Arm a single firing tower at the entry-adjacent TOWER spot and harvest it (KEEP), which
 * launches the level's Wave 1. Returns the tower's id (a KEEP promotes the candidate to a
 * component of the same id). The caller then spawns controlled units and measures inside
 * the ~0.6 s window before Wave 1 begins releasing its own units.
 */
export async function armTower(api, { type = "capacitor", tier = 1, seed = 1, difficulty = "medium", charge } = {}) {
  await startBuild(api, { seed, difficulty, charge });
  const cand = await placeCandidate(api, type, tier, TOWER.col, TOWER.row);
  await api.call("keep", cand.id);
  return cand.id;
}

/**
 * Spawn controlled Load units at the Entry through the real spawner and return the NEW
 * units (diffed against those already live), so a caller can track exactly the units it
 * released. In the build phase this transitions to the wave phase with NO composed wave, so
 * the units walk the real pathfinder with nothing else on the floor.
 */
export async function spawnControlled(api, type, opts = {}) {
  const before = new Set((await api.snapshot()).units.map((u) => u.id));
  await api.call("spawnUnit", type, opts);
  const after = (await api.snapshot()).units;
  return after.filter((u) => !before.has(u.id));
}

/**
 * Assemble a combination tower by the real recipe-combine: place each (type,tier) ingredient
 * as a candidate (the first at the entry-adjacent anchor so the combo lands in range of
 * entry-spawned units), set the explicit combine multiset, and commit. Returns the combo
 * tower's id (it lands at the anchor/initiator footprint). A fresh-consuming recipe is the
 * level's harvest, so this also launches Wave 1.
 */
export async function assembleCombo(api, comboId, { seed = 1, charge = 400, difficulty = "medium" } = {}) {
  const recipe = RECIPES[comboId];
  await startBuild(api, { seed, charge, difficulty });
  const ids = [];
  for (let i = 0; i < recipe.length; i += 1) {
    const [type, tier] = recipe[i];
    const spot = SPOTS[i];
    const cand = await placeCandidate(api, type, tier, spot.col, spot.row);
    ids.push(cand.id);
  }
  await api.call("setCombineSet", ids);
  await api.call("combine", ids[0]);
  const s = await api.snapshot();
  const combo = s.towers.find((t) => t.kind === "combo" && t.col === SPOTS[0].col && t.row === SPOTS[0].row);
  return { comboId: combo ? combo.id : null, ingredientIds: ids };
}

/** Step until the wave clears and the build phase reopens (or the run ends). */
export async function clearWave(api, maxSeconds = 240) {
  const r = await stepUntil(api, (s) => s.phase === "build" || s.screen !== "playing", maxSeconds, 0.25);
  return r.snap;
}

// ---- Targeting pose helpers ----------------------------------------------------
//
// Both pose a single entry-adjacent Emitter (single-target, so only the chosen unit is
// hit, and its head aimAngle tracks the chosen target every tick regardless of cadence).
// Measurements finish inside the ~0.6 s window before the kept level's own Wave 1 begins
// releasing units, so nothing else is on the floor.

/**
 * Pose two units that differ in PROGRESS and DISTANCE: unit `a` is spawned first and
 * stepped forward a little (so it is further along the chain and nearer the tower), then
 * unit `b` is spawned fresh at the Entry. Sets the targeting `mode` and reads the head's
 * heading, so a caller can assert which unit the head aims at. Returns `{ t, la, lb }`
 * (the tower snap and the two live units).
 */
export async function poseHeadTargets(api, mode) {
  const towerId = await armTower(api, { type: "emitter", tier: 1 });
  const [a] = await spawnControlled(api, "mote");
  await api.step(0.2); // a advances along the first leg (further along, and nearer the tower)
  const [b] = await spawnControlled(api, "mote"); // fresh at the Entry (least far, farther)
  await api.call("setTargeting", towerId, mode);
  await api.step(0.03); // the head re-acquires and aims at the chosen target
  const s = await api.snapshot();
  return { towerId, t: towerById(s, towerId), la: unitById(s, a.id), lb: unitById(s, b.id) };
}

/**
 * Pose two colocated units that differ in HP: a Slug (high HP) and a Cluster (low HP),
 * released at the same tick so progress/distance tie and only HP distinguishes them. Sets
 * the targeting `mode` and steps until the first shot lands, so a caller can assert which
 * unit lost HP (the single-target Emitter hits only its chosen target). Returns the two
 * live units and their pre-shot HP.
 */
export async function poseHpTargets(api, mode) {
  const towerId = await armTower(api, { type: "emitter", tier: 1 });
  const [slug] = await spawnControlled(api, "slug");
  const [cluster] = await spawnControlled(api, "cluster");
  await api.call("setTargeting", towerId, mode);
  const s0 = await api.snapshot();
  const slugHp0 = unitById(s0, slug.id).hp;
  const clHp0 = unitById(s0, cluster.id).hp;
  await stepUntil(
    api,
    (s) => {
      const a = unitById(s, slug.id);
      const b = unitById(s, cluster.id);
      return (a && a.hp < slugHp0) || (b && b.hp < clHp0);
    },
    0.5,
    FIXED,
  );
  const s = await api.snapshot();
  return { slug: unitById(s, slug.id), cluster: unitById(s, cluster.id), slugHp0, clHp0 };
}

// ---- Read helpers --------------------------------------------------------------
export function towerById(s, id) {
  return s.towers.find((t) => t.id === id) ?? null;
}
export function unitById(s, id) {
  return s.units.find((u) => u.id === id) ?? null;
}
export function towerAt(s, col, row) {
  return s.towers.find((t) => t.col === col && t.row === row) ?? null;
}

// The angle from a tower center to a unit, and the smallest difference between two angles
// (for asserting a firing head aims at the chosen target).
export function angleTo(cx, cy, u) {
  return Math.atan2(u.y - cy, u.x - cx);
}
export function angDiff(a, b) {
  const d = Math.abs(a - b) % (2 * Math.PI);
  return d > Math.PI ? 2 * Math.PI - d : d;
}

// ---- Motion clip ---------------------------------------------------------------
/**
 * Hand the clock back to the animation-frame loop and let real time pass, so the recorded
 * video output shows the board actually in motion (stepping advances the sim instantly and
 * animates nothing). Used only AFTER the deterministic, manual-clock measurement.
 */
export async function liveClip(api, ms = 1600) {
  await api.call("setAutoStep", true);
  await api.wait(ms);
}
