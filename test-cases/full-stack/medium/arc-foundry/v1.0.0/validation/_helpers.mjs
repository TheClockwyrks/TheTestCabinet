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
// `check` kit the runtime hands an item's `assert` phase
// (packages/browser-driver/validation.mjs), shared by every case. This file holds only
// what is specific to Arc Foundry.
//
// THE ARRANGE/ACT SEAM. An item is an `{ id, arrange, act, assert }` triple that the
// runtime runs TWICE from one implementation: once with time instant (deciding the
// verdict) and once in real time (recording the media). The two phases therefore mean
// different things and a helper must belong to exactly one of them:
//
//   * `arrange` is INSTANT and runs in BOTH passes. Only control ops belong here —
//     the setters that pose a board. Calling api.advance()/api.until() from arrange
//     THROWS.
//   * `act` is the only phase that consumes time, and the only thing filmed. It may
//     still call control ops (to pose a second scenario mid-scene); it may NOT call
//     api.reset(), which would hand the build back to its manual clock and silently
//     freeze the recording.
//
// So a helper that only poses state (`startBuild`, `placeCandidate`, `armTower`,
// `spawnControlled`, `assembleCombo`) is arrange-phase and used as-is, while a helper
// that consumes time is split into an `arrangeX` half and an `actX` half — the arrange
// half returns the ids the act half needs. Nothing here calls `setAutoStep`: the
// runtime owns the clock in both passes.
//
// UNITS ARE TICKS. The debug API's `step` counts whole simulation ticks of the fixed
// 60 Hz timestep (specs/instrumentation.md), so `api.advance(n)` / the `max` and
// `poll` of `api.until` are tick counts, not seconds. One second of game time is 60
// ticks. Nothing is rounded — a fractional count is rejected — so a measurement is
// exact and reproducible regardless of machine load.

// ---- Stage + grid geometry (specs/board.md, specs/overview.md) -----------------
export const STAGE_W = 1280;
export const STAGE_H = 720;
export const STATUS_H = 56; // top status bar; the board grid is anchored at (0, 56)
export const TILE = 20; // 20 px tiles
export const GRID_COLS = 50;
export const GRID_ROWS = 33;

// ---- The simulation clock (specs/controls.md, specs/instrumentation.md) --------
// The sim runs on a fixed 60 Hz timestep and the debug API counts whole ticks of it,
// so every duration below — and every `advance`/`until` a script writes — is a TICK
// COUNT. Multiply seconds by TICK_HZ to convert.
export const TICK_HZ = 60; // the fixed simulation rate, in Hz (matches FIXED_STEP = 1/60)
export const TICK = 1; // one tick — the finest `poll`, for reading the instant something happens
export const SECOND = 60; // one second of game time, in ticks

// A tile's center in logical-pixel space.
export function tileCenter(col, row) {
  return { x: TILE * col + TILE / 2, y: STATUS_H + TILE * row + TILE / 2 };
}
// A 2x2 footprint's center (used for range, targeting, drawing): (20*(col+1), 56+20*(row+1)).
export function footprintCenter(col, row) {
  return { x: TILE * (col + 1), y: STATUS_H + TILE * (row + 1) };
}

// ---- Economy / balance constants (constants.ts, specs/gameplay.md) -----------------
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
  medium: { waves: 50, baseMult: 0.22, k: 1.17, surchargeC: 0.28, surchargeR: 1.145 },
  hard: { waves: 60, baseMult: 0.24, k: 1.3, surchargeC: 0.22, surchargeR: 1.15 },
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

// `stepUntil` is gone: the runtime's `api.until(pred, { max, poll })` is the same drive,
// advancing until `pred(snapshot)` holds or `max` ticks are spent and returning
// `{ snap, hit, spent }`. Pass a coarse `poll` when the quantity read is constant between
// events (a long traverse), or `TICK` to read state the instant something happens.

/**
 * ARRANGE. Reset (reseeding all randomness) and begin a run at its opening build phase.
 * `charge` optionally overrides the starting Charge as a precondition for an upgrade.
 * Returns the opening snapshot. Poses only — call it from `arrange`, never from `act`
 * (it resets, which would hand the build back to its own clock mid-recording).
 */
export async function startBuild(api, { seed = 1, map = "substation", difficulty = "medium", charge } = {}) {
  await api.reset({ seed });
  await api.call("startRun", { map, difficulty });
  if (charge != null) await api.call("setCharge", charge);
  return api.snapshot();
}

/**
 * ARRANGE. Arm the exact roll and drop a rock at (col,row) through the real placement path,
 * landing a candidate. Returns the placed candidate's snapshot entry, or null if the drop
 * was refused (illegal footprint). Instant — a placement consumes no game time.
 */
export async function placeCandidate(api, type, tier, col, row) {
  await api.call("setNextRoll", type, tier);
  await api.call("placeRock", col, row);
  const s = await api.snapshot();
  return s.towers.find((t) => t.col === col && t.row === row && t.kind === "candidate") ?? null;
}

/**
 * ARRANGE. Arm a single firing tower at the entry-adjacent TOWER spot and harvest it (KEEP),
 * which launches the level's Wave 1. Returns the tower's id (a KEEP promotes the candidate to
 * a component of the same id). The caller then spawns controlled units and measures inside
 * the ~36-tick (0.6 s) window before Wave 1 begins releasing its own units.
 */
export async function armTower(api, { type = "capacitor", tier = 1, seed = 1, difficulty = "medium", charge } = {}) {
  await startBuild(api, { seed, difficulty, charge });
  const cand = await placeCandidate(api, type, tier, TOWER.col, TOWER.row);
  await api.call("keep", cand.id);
  return cand.id;
}

/**
 * ARRANGE (or mid-`act`). Spawn controlled Load units at the Entry through the real spawner
 * and return the NEW
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
 * ARRANGE. Assemble a combination tower by the real recipe-combine: place each (type,tier)
 * ingredient
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

/**
 * ACT. Run the real simulation until the wave clears and the build phase reopens (or the run
 * ends), and return the snapshot at that instant. Polls coarsely (every 15 ticks, a quarter
 * second) because nothing read here changes between the wave ending and the phase flipping.
 * `maxTicks` defaults to 14400 ticks — four minutes of game time, long enough for a full
 * wave to walk the chain and die.
 *
 * Replaces the old `clearWave(api, maxSeconds)`; the seconds budget is now a tick budget.
 */
export async function actClearWave(api, { maxTicks = 240 * SECOND, poll = 15 } = {}) {
  const r = await api.until((s) => s.phase === "build" || s.screen !== "playing", { max: maxTicks, poll });
  return r.snap;
}

// ---- Targeting pose helpers ----------------------------------------------------
//
// Both pose a single entry-adjacent Emitter (single-target, so only the chosen unit is
// hit, and its head aimAngle tracks the chosen target every tick regardless of cadence).
// Measurements finish inside the ~36-tick (0.6 s) window before the kept level's own Wave 1
// begins releasing units, so nothing else is on the floor.
//
// Each is split across the arrange/act seam. The head pose needs game time to pass BETWEEN
// its two spawns (that gap is what separates the units along the chain), so only the first
// spawn can be arranged; the rest is the act. The HP pose releases both units on the same
// tick, so the whole board can be arranged and only the wait for the shot is the act.

/**
 * ARRANGE half of the head-targeting pose: arm the Emitter and release unit `a`, the unit
 * that will end up further along the chain. Returns `{ towerId, aId }` for the act half.
 *
 * Pair with `actHeadTargets`.
 */
export async function arrangeHeadTargets(api) {
  const towerId = await armTower(api, { type: "emitter", tier: 1 });
  const [a] = await spawnControlled(api, "mote");
  return { towerId, aId: a.id };
}

/**
 * ACT half of the head-targeting pose: let unit `a` walk ahead, release unit `b` fresh at the
 * Entry behind it, set the targeting `mode`, and let the head re-acquire — so the two units
 * differ in PROGRESS and DISTANCE and a caller can assert which one the head aims at.
 * Returns `{ towerId, t, la, lb }` (the tower snap and the two live units), exactly what the
 * old `poseHeadTargets` returned.
 *
 * Pair with `arrangeHeadTargets`.
 */
export async function actHeadTargets(api, { towerId, aId }, mode) {
  // 12 ticks (0.2 s): a advances along the first leg (further along, and nearer the tower).
  await api.advance(12);
  const [b] = await spawnControlled(api, "mote"); // fresh at the Entry (least far, farther)
  await api.call("setTargeting", towerId, mode);
  // 2 ticks: the head re-acquires and aims at the chosen target. (The old script asked for
  // 0.03 s, which is 1.8 ticks and which the old seconds-based step rounded to 2; 2 keeps
  // the measurement identical now that a fractional tick count is rejected outright.)
  await api.advance(2);
  const s = await api.snapshot();
  return { towerId, t: towerById(s, towerId), la: unitById(s, aId), lb: unitById(s, b.id) };
}

/**
 * ARRANGE half of the HP-targeting pose: arm the Emitter, release a Slug (high HP) and a
 * Cluster (low HP) on the SAME tick so progress and distance tie and only HP distinguishes
 * them, and set the targeting `mode`. Returns `{ towerId, slugId, clusterId }` for the act
 * half. All instant — no game time passes between the two releases.
 *
 * Pair with `actHpTargets`.
 */
export async function arrangeHpTargets(api, mode) {
  const towerId = await armTower(api, { type: "emitter", tier: 1 });
  const [slug] = await spawnControlled(api, "slug");
  const [cluster] = await spawnControlled(api, "cluster");
  await api.call("setTargeting", towerId, mode);
  return { towerId, slugId: slug.id, clusterId: cluster.id };
}

/**
 * ACT half of the HP-targeting pose: read both units' pre-shot HP, then run the real
 * simulation until the first shot lands, so a caller can assert which unit lost HP (the
 * single-target Emitter hits only its chosen target). Polls one tick at a time because the
 * instant the HP drops is what is read. 30 ticks (0.5 s) is the budget, as before. Returns
 * `{ slug, cluster, slugHp0, clHp0 }`, exactly what the old `poseHpTargets` returned.
 *
 * Pair with `arrangeHpTargets`.
 */
export async function actHpTargets(api, { slugId, clusterId }) {
  const s0 = await api.snapshot();
  const slugHp0 = unitById(s0, slugId).hp;
  const clHp0 = unitById(s0, clusterId).hp;
  await api.until(
    (s) => {
      const a = unitById(s, slugId);
      const b = unitById(s, clusterId);
      return (a && a.hp < slugHp0) || (b && b.hp < clHp0);
    },
    { max: 30, poll: TICK },
  );
  const s = await api.snapshot();
  return { slug: unitById(s, slugId), cluster: unitById(s, clusterId), slugHp0, clHp0 };
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
//
// `liveClip` is gone, and nothing replaces it. It existed to hand the clock back and burn
// real time at the END of a script so the recorded video showed the board in motion; under
// the two-pass runtime the `act` phase IS the clip — the record pass replays exactly that
// phase in real time, filming the very scenario the item checks. An item that wants motion
// in its media puts the motion in `act`; there is no separate tail to append, and no script
// ever touches `setAutoStep`.
