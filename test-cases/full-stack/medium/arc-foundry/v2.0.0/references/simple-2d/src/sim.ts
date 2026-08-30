// Arc Foundry — the simulation (specs/yard.md, specs/pathing.md, specs/components.md,
// specs/scrap-press.md, specs/combinations.md, specs/campaign.md, specs/economy.md).
//
// The Load mazing the ordered chain around the walls, the scrap-press build loop, the
// quality ladder and the refinement track, the eight base types and the twelve
// combination towers firing travelling shots, the status effects, the economy, and the
// campaign with its milestone bosses and its finale.
//
// EVERYTHING HERE IS A FUNCTION OVER A WORLD. Each takes the `FoundryWorld` it acts on
// as its first argument and advances it in place, and the world it is handed is always
// one the caller owns: `update` copies the read-only state the engine gave it into a
// fresh world before a step touches anything, and a debug pose does the same
// (`src/world.ts`). So a frame never writes to the state the previous frame left, and
// the fact that nothing but a transition can change the game is the type system's, not
// a convention.
//
// The simulation is free of the canvas, the clock, and input: it advances from the
// elapsed time it is handed and from the seeded generators the world carries, so an
// interval of simulation time reaches the same state however it was divided into
// frames, and a scenario driven a counted number of steps reproduces exactly.

import {
  COMBOS,
  COMBO_MAX_LEVEL,
  COMPONENT_TYPES,
  DEFAULT_SEED,
  DEFAULT_TARGETING,
  MAX_QUALITY,
  OVERLOAD_SPEED,
  PROJECTILE_HIT_R,
  PROJECTILE_SPEED,
  REFINEMENT_MAX,
  REFINEMENT_ODDS,
  STAMPS_PER_LEVEL,
  START_CHARGE,
  START_INTEGRITY,
  TARGETING_PRIORITIES,
  TILE,
  TYPE_ROLL_ODDS,
  type ComboId,
  type ComponentType,
  type CueName,
  type DifficultyId,
  type LoadType,
  type MapId,
  type PhaseName,
  type ScreenName,
  type Speed,
  type TargetingPriority,
} from "./constants";
import { boardOf, type Board, type Occupancy } from "./board";
import { fireCue } from "./audio";
import { next, stream } from "./rng";
import {
  COMBO_BY_ID,
  DIFFICULTY_BY_ID,
  LOAD_BY_TYPE,
  MAX_AURA,
  comboStats,
  comboUpgradeCost,
  baseStats,
  footprintCenter,
  loadRadius,
  recipeKey,
  refinementCost,
  scaledHealth,
  tileCenter,
  waveClearBonus,
  type Stats,
} from "./tables";
import { buildWave } from "./waves";
import type { FoundryView } from "./world";
import type { Assets } from "./assets";
import type { DeepReadonly } from "ts-essentials";
import type {
  Blocker,
  Candidate,
  Component,
  FoundryWorld,
  Pt,
  Projectile,
  Structure,
  Unit,
  Wave,
} from "./types";

/**
 * The simulation's tick, in seconds.
 *
 * The engine measures a frame's real elapsed time and the game drains it in whole ticks
 * of this size, so an interval of simulation time reaches the same state whatever frame
 * rate produced it and whatever speed multiplier is running. It is the game's own
 * figure rather than the engine's: the engine owns the frame, the game owns the tick.
 */
export const FIXED_STEP = 1 / 60;

/** The most ticks one frame may drain, so a tab returning from the background catches up. */
const MAX_STEPS_PER_FRAME = 600;

/** The default state of the scrap-press generator, before a seed replaces it. */
const PRESS_SEED = 0x51a6c0de;

/** What the crit generator is derived from, so the two streams never run in step. */
const COMBAT_SALT = 0x2f9d3b17;

// ---- Reading a world, and advancing one ----------------------------------
//
// A function that ADVANCES the world takes a `FoundryWorld`: a world the caller owns
// outright, which `src/world.ts` produced for it. A function that only READS one takes a
// `FoundryView`, so the renderer, the diagnostics, and the surface's readings — none of
// which owns a world — reach exactly the same queries the simulation does, and a caller
// that does own one passes it straight in. A reader hands back what it found under the
// same read-only view it was reading, so nothing that came out of a query can be
// written through.

/** The board of the world's map. */
export function board(w: FoundryView): Board {
  return boardOf(w.mapId);
}

/** The world's difficulty. */
export function difficulty(w: FoundryView) {
  return DIFFICULTY_BY_ID[w.difficultyId];
}

/** The occupancy of the yard as it now stands. */
export function occupancyOf(w: FoundryView): Occupancy {
  return board(w).occupancy(w.structures);
}

/** The component with this identity, in a world the caller may advance. */
function ownComponent(w: FoundryWorld, id: number): Component | null {
  for (const s of w.structures)
    if (s.id === id && s.kind === "component") return s;
  return null;
}

/** The candidate with this identity, in a world the caller may advance. */
function ownCandidate(w: FoundryWorld, id: number): Candidate | null {
  const s = w.structures.find((x) => x.id === id);
  return s && s.kind === "candidate" ? s : null;
}

/** The live unit with this identity, in a world the caller may advance. */
export function ownUnit(w: FoundryWorld, id: number): Unit | null {
  const u = w.units.find((x) => x.id === id);
  return u && !u.dead ? u : null;
}

/** The next draw from the scrap-press generator, advancing the world's copy of it. */
function pressDraw(w: FoundryWorld): number {
  const rng = stream(w.pressRng);
  const value = next(rng);
  w.pressRng = rng.state;
  return value;
}

/** The next draw from the crit generator, advancing the world's copy of it. */
function combatDraw(w: FoundryWorld): number {
  const rng = stream(w.combatRng);
  const value = next(rng);
  w.combatRng = rng.state;
  return value;
}

// ---- Building a world ----------------------------------------------------

/** A world on the title screen, with every field at the value `reset` restores. */
export function createWorld(assets: Assets): FoundryWorld {
  const w: FoundryWorld = {
    screen: "title",
    phase: "build",
    paused: false,
    menuIndex: 0,
    mapId: "substation",
    difficultyId: "medium",
    charge: START_CHARGE,
    integrity: START_INTEGRITY,
    maxIntegrity: START_INTEGRITY,
    mazeRating: 0,
    finale: false,
    wave: 0,
    speed: 1,
    units: [],
    projectiles: [],
    structures: [],
    holding: false,
    selectedId: null,
    combineIds: [],
    stampsUsed: 0,
    refinement: 0,
    harvest: { mode: "none" },
    armedRoll: null,
    kills: 0,
    leakCount: 0,
    activeWave: null,
    spawnerHeld: false,
    nextWave: buildWave(1, DIFFICULTY_BY_ID.medium),
    spawnCursor: 0,
    waveClock: 0,
    simTime: 0,
    stepAcc: 0,
    renderAlpha: 0,
    clockTime: 0,
    nextId: 1,
    pressRng: PRESS_SEED,
    pressSeed: PRESS_SEED,
    combatRng: (PRESS_SEED ^ COMBAT_SALT) >>> 0,
    mazePath: [],
    mazeLength: 0,
    muted: false,
    pointerX: -1,
    pointerY: -1,
    showCombos: false,
    showDamage: false,
    bursts: [],
    fxQueue: [],
    cueQueue: [],
    assets,
  };
  refreshMaze(w);
  return w;
}

/**
 * Return the world to its title state and reseed every random draw.
 *
 * Every field the snapshot reports goes back to its title-screen value. The mute bit
 * and the pointer are deliberately left alone, because both belong to the runtime
 * rather than to the game, and so are the loaded assets and the bursts still playing.
 */
export function resetWorld(w: FoundryWorld, seed: number = DEFAULT_SEED): void {
  w.pressSeed = seed >>> 0;
  w.mapId = "substation";
  w.difficultyId = "medium";
  w.screen = "title";
  w.phase = "build";
  w.menuIndex = 0;
  w.paused = false;
  w.charge = START_CHARGE;
  w.integrity = START_INTEGRITY;
  w.maxIntegrity = START_INTEGRITY;
  w.mazeRating = 0;
  w.finale = false;
  w.wave = 0;
  w.speed = 1;
  w.units = [];
  w.projectiles = [];
  w.structures = [];
  w.holding = false;
  w.selectedId = null;
  w.combineIds = [];
  w.stampsUsed = 0;
  w.refinement = 0;
  w.harvest = { mode: "none" };
  w.armedRoll = null;
  w.kills = 0;
  w.leakCount = 0;
  w.showCombos = false;
  w.showDamage = false;
  w.fxQueue = [];
  w.cueQueue = [];
  w.activeWave = null;
  w.spawnerHeld = false;
  w.spawnCursor = 0;
  w.waveClock = 0;
  w.simTime = 0;
  w.stepAcc = 0;
  w.renderAlpha = 0;
  w.nextId = 1;
  w.pressRng = w.pressSeed;
  w.combatRng = (w.pressSeed ^ COMBAT_SALT) >>> 0;
  w.nextWave = buildWave(1, difficulty(w));
  refreshMaze(w);
}

/**
 * Enter a run on the current map at the current difficulty, opening it on its first
 * build phase with the allocation `specs/campaign.md` states.
 *
 * It never reseeds. Every random draw runs off the generator `reset` seeded, and nothing
 * else seeds it, so the same seed and the same calls reach the same run every time.
 */
export function startRun(w: FoundryWorld): void {
  w.screen = "playing";
  w.phase = "build";
  w.paused = false;
  w.charge = START_CHARGE;
  w.integrity = START_INTEGRITY;
  w.maxIntegrity = START_INTEGRITY;
  w.mazeRating = 0;
  w.finale = false;
  w.wave = 0;
  w.speed = 1;
  w.units = [];
  w.projectiles = [];
  w.structures = [];
  w.holding = false;
  w.selectedId = null;
  w.combineIds = [];
  w.stampsUsed = 0;
  w.refinement = 0;
  w.harvest = { mode: "none" };
  w.menuIndex = 0;
  w.kills = 0;
  w.leakCount = 0;
  w.fxQueue = [];
  w.cueQueue = [];
  w.activeWave = null;
  w.spawnerHeld = false;
  w.spawnCursor = 0;
  w.waveClock = 0;
  w.simTime = 0;
  w.stepAcc = 0;
  w.renderAlpha = 0;
  w.nextId = 1;
  // The press keeps whatever `setNextRoll` armed: only a rock consuming it or
  // `clearNextRoll` clears the arming (specs/instrumentation.md).
  w.pressRng = w.pressSeed;
  w.combatRng = (w.pressSeed ^ COMBAT_SALT) >>> 0;
  w.nextWave = buildWave(1, difficulty(w));
  refreshMaze(w);
}

// ---- Cues and effects ----------------------------------------------------

/**
 * Raise one cue on the frame in progress, at most once.
 *
 * A frame on which a whole pack dies plays one kill cue rather than one per unit
 * (specs/ui.md). The queue is drained by the same frame that filled it.
 */
function raiseCue(w: FoundryWorld, cue: CueName): void {
  if (w.cueQueue.includes(cue)) return;
  w.cueQueue.push(cue);
}

// ---- The frame's advance -------------------------------------------------

/**
 * Advance the simulation by `seconds` of real elapsed time.
 *
 * The clock runs on the playing screen and nowhere else, and stops dead under the
 * in-place pause. The span is multiplied by the speed and then drained in whole ticks,
 * with the number of ticks computed from the accumulated span rather than counted out by
 * repeated subtraction: subtracting repeatedly accumulates a rounding error worth a whole
 * tick over a second, which would leave the same interval in two different places
 * depending on how it was divided into frames.
 */
export function advance(w: FoundryWorld, seconds: number): void {
  w.clockTime += seconds;
  if (w.screen === "playing" && !w.paused) {
    w.stepAcc += seconds * w.speed;
    const steps = Math.min(
      Math.floor(w.stepAcc / FIXED_STEP + 1e-9),
      MAX_STEPS_PER_FRAME,
    );
    for (let i = 0; i < steps; i++) {
      syncView(w);
      fixedStep(w, FIXED_STEP);
    }
    w.stepAcc -= steps * FIXED_STEP;
    w.renderAlpha = w.stepAcc / FIXED_STEP;
  } else {
    // Frozen, by the in-place pause or by a screen off the yard. The accumulator is
    // dropped so no burst of ticks fires the moment play resumes.
    w.stepAcc = 0;
    w.renderAlpha = 0;
  }
}

/**
 * Stamp the interpolation window, once per tick.
 *
 * The simulation advances in whole ticks but a frame is drawn whenever the display asks
 * for one, and the two rates do not divide evenly. The renderer draws between where a
 * body stood when the tick began and where it stands now. Nothing here feeds back into
 * the simulation.
 */
function syncView(w: FoundryWorld): void {
  for (const u of w.units) {
    u.prevX = u.x;
    u.prevY = u.y;
  }
  for (const p of w.projectiles) {
    p.prevX = p.x;
    p.prevY = p.y;
  }
}

/** One tick of the simulation. */
export function fixedStep(w: FoundryWorld, dt: number): void {
  if (w.screen !== "playing" || w.paused) return;
  w.simTime += dt;

  // Grid Integrity at or below zero ends the run at any point, so defeat is resolved
  // before the phase decides how much of the tick runs: a build phase with the grid
  // already at zero ends in defeat exactly as a live wave does.
  if (w.integrity <= 0) {
    lose(w);
    return;
  }

  if (w.phase === "build") {
    // A build phase is untimed: nothing starts the wave but the level's harvest. The
    // clock still runs, so a status effect posed in a build phase runs down.
    for (const s of w.structures) if (s.kind === "component") s.fireAnim += dt;
    return;
  }

  const occ = occupancyOf(w);
  w.waveClock += dt * 1000;
  spawnDue(w, occ);
  stepComponents(w, dt);
  stepUnits(w, dt, occ);
  // Shots move after the units do, so homing stays accurate within the tick.
  stepProjectiles(w, dt);
  cullDead(w);
  // Defeat resolves immediately, so the leak that empties the grid on the very tick
  // that would clear the wave ends the run instead of opening a build phase.
  if (w.integrity <= 0) {
    lose(w);
    return;
  }
  checkWaveEnd(w);
}

function spawnDue(w: FoundryWorld, occ: Occupancy): void {
  const wave = w.activeWave;
  if (!wave) return;
  while (
    w.spawnCursor < wave.events.length &&
    wave.events[w.spawnCursor]!.atMs <= w.waveClock
  ) {
    w.units.push(makeUnit(w, wave.events[w.spawnCursor]!.type, occ));
    w.spawnCursor++;
  }
}

// ---- Units ---------------------------------------------------------------

/**
 * A unit of `type`, at the map's entry, scaled to the current wave.
 *
 * The scaling is defined from wave `1` and a run reaches wave `1` before it releases a
 * unit of its own, so a unit released while the counter still reads `0` takes wave
 * `1`'s health, which is the lowest the scaling defines.
 */
function makeUnit(w: FoundryWorld, type: LoadType, occ: Occupancy): Unit {
  const def = LOAD_BY_TYPE[type];
  const b = board(w);
  const hp = scaledHealth(def.baseHealth, Math.max(1, w.wave), difficulty(w));
  const entry = b.chain[0]!;
  const at = tileCenter(entry.col, entry.row);
  const u: Unit = {
    id: w.nextId++,
    type,
    flies: def.flies,
    hp,
    maxHp: hp,
    speed: def.speed,
    bounty: def.bounty,
    leak: def.leak,
    radius: loadRadius(type),
    x: at.x,
    y: at.y,
    prevX: at.x,
    prevY: at.y,
    // Heading for chain[1], WP1; chain[0] is the entry it stands on.
    wpIndex: 1,
    route: [],
    routeStep: 0,
    progress: 0,
    animT: 0,
    hitFlash: 999,
    slowFactor: 1,
    slowUntil: 0,
    burnDps: 0,
    burnUntil: 0,
    burnSourceId: 0,
    invincible: false,
    frozen: false,
    dead: false,
  };
  u.route = b.routeFor({ x: u.x, y: u.y }, u.wpIndex, occ, u.flies);
  u.progress = remainingTiles(u);
  return u;
}

/**
 * Rebuild every walking unit's route from where it stands, refresh the auras, and
 * recompute the ground route. Called whenever the walls move.
 */
export function rePath(w: FoundryWorld): void {
  const occ = occupancyOf(w);
  const b = board(w);
  for (const u of w.units) {
    if (u.dead) continue;
    u.route = b.routeFor({ x: u.x, y: u.y }, u.wpIndex, occ, u.flies);
    u.routeStep = 0;
  }
  recomputeAuras(w);
  refreshMaze(w);
}

/**
 * The ground route through the chain, and its length in tiles.
 *
 * The route changes only when the walls do, so it is recomputed where they change
 * rather than every frame, and the renderer and the snapshot read the stored value.
 */
export function refreshMaze(w: FoundryWorld): void {
  const b = board(w);
  const occ = occupancyOf(w);
  const path: Pt[] = [];
  const first = b.chain[0]!;
  path.push(tileCenter(first.col, first.row));
  for (let i = 1; i < b.chain.length; i++) {
    const from = b.chain[i - 1]!;
    const to = b.chain[i]!;
    const seg = b.pathTiles(from, to, occ);
    if (seg && seg.length > 0) {
      for (let j = 1; j < seg.length; j++) path.push(seg[j]!);
    } else {
      // Never-seal keeps every segment open, so this is a safety fallback alone.
      path.push(tileCenter(to.col, to.row));
    }
  }
  let d = 0;
  for (let i = 1; i < path.length; i++) {
    d += Math.hypot(path[i]!.x - path[i - 1]!.x, path[i]!.y - path[i - 1]!.y);
  }
  w.mazePath = path;
  w.mazeLength = d / TILE;
}

/**
 * Cache each firing structure's total external aura.
 *
 * A Regulator, and some combination towers, project a passive damage aura over every
 * firing structure whose center falls inside it. A structure never buffs itself, and the
 * sum is capped, so a wall of Regulators cannot run away with the run.
 */
export function recomputeAuras(w: FoundryWorld): void {
  const sources: {
    x: number;
    y: number;
    r2: number;
    bonus: number;
    id: number;
  }[] = [];
  for (const s of w.structures) {
    if (s.kind !== "component") continue;
    const st = unbuffedStats(s);
    if (st.auraRadius > 0 && st.auraBonus > 0) {
      const at = footprintCenter(s.col, s.row);
      sources.push({
        x: at.x,
        y: at.y,
        r2: st.auraRadius * st.auraRadius,
        bonus: st.auraBonus,
        id: s.id,
      });
    }
  }
  for (const s of w.structures) {
    if (s.kind !== "component") continue;
    if (!unbuffedStats(s).fires) {
      s.auraBonus = 0;
      continue;
    }
    const at = footprintCenter(s.col, s.row);
    let sum = 0;
    for (const src of sources) {
      if (src.id === s.id) continue;
      const dx = at.x - src.x;
      const dy = at.y - src.y;
      if (dx * dx + dy * dy <= src.r2) sum += src.bonus;
    }
    s.auraBonus = Math.min(MAX_AURA, sum);
  }
}

/** A structure's own block, before any aura on it. */
export function unbuffedStats(c: DeepReadonly<Component>): Stats {
  return c.combo
    ? comboStats(c.combo, c.comboLevel)
    : baseStats(c.type, c.quality);
}

/**
 * A structure's live block, including the aura standing on it.
 *
 * The buffed figure is deliberately not rounded: the aura multiplies the per-shot
 * damage and the product carries its fraction into the hit.
 */
export function statsOf(c: DeepReadonly<Component>): Stats {
  const st = unbuffedStats(c);
  if (c.auraBonus > 0 && st.dmg > 0)
    return { ...st, dmg: st.dmg * (1 + c.auraBonus) };
  return st;
}

// ---- Firing --------------------------------------------------------------

function stepComponents(w: FoundryWorld, dt: number): void {
  for (const s of w.structures) {
    if (s.kind !== "component") continue;
    s.fireAnim += dt;
    const stats = statsOf(s);
    if (!stats.fires) continue;
    const center = footprintCenter(s.col, s.row);
    const targets = pickTargets(w, s, stats, center);
    if (targets.length > 0) {
      s.aimAngle = Math.atan2(
        targets[0]!.y - center.y,
        targets[0]!.x - center.x,
      );
    }
    s.cooldown -= dt;
    if (s.cooldown > 0 || targets.length === 0) continue;
    s.cooldown = 1 / stats.fireRate;
    s.fireAnim = 0;
    for (const t of targets) launchProjectile(w, s, stats, center, t);
    raiseCue(w, fireCue(s));
  }
}

/**
 * The in-range units this structure fires at this cadence, under its priority: one for
 * a single-target structure, up to `multishot` distinct units for a tower that fires at
 * several at once.
 */
function pickTargets(
  w: FoundryWorld,
  c: Component,
  stats: Stats,
  center: Pt,
): Unit[] {
  const r2 = stats.range * stats.range;
  const inRange: Unit[] = [];
  for (const u of w.units) {
    if (u.dead) continue;
    const dx = u.x - center.x;
    const dy = u.y - center.y;
    if (dx * dx + dy * dy <= r2) inRange.push(u);
  }
  if (inRange.length === 0) return [];
  inRange.sort((a, b) => rank(c.targeting, a, b, center));
  return inRange.slice(0, Math.max(1, stats.multishot));
}

/**
 * Order two in-range units under a priority, the better first.
 *
 * Every priority breaks its ties toward the unit further along the chain, and then by
 * identity, so the choice never depends on the order the units happen to sit in.
 */
function rank(mode: TargetingPriority, a: Unit, b: Unit, center: Pt): number {
  let primary = 0;
  switch (mode) {
    case "first":
      primary = -aheadOf(a, b);
      break;
    case "last":
      primary = aheadOf(a, b);
      break;
    case "nearest": {
      const da = dist2(a, center);
      const db = dist2(b, center);
      primary = da === db ? 0 : da < db ? -1 : 1;
      break;
    }
    case "strongest":
      primary = a.hp === b.hp ? 0 : a.hp > b.hp ? -1 : 1;
      break;
    case "weakest":
      primary = a.hp === b.hp ? 0 : a.hp < b.hp ? -1 : 1;
      break;
  }
  if (primary !== 0) return primary;
  const ahead = aheadOf(a, b);
  if (ahead !== 0) return -ahead;
  return a.id - b.id;
}

function dist2(u: Unit, center: Pt): number {
  const dx = u.x - center.x;
  const dy = u.y - center.y;
  return dx * dx + dy * dy;
}

function launchProjectile(
  w: FoundryWorld,
  c: Component,
  stats: Stats,
  center: Pt,
  target: Unit,
): void {
  // Where the bolt is DRAWN from: the head, a little off the footprint's center. The
  // shot itself launches from the center, which is what the range is measured from.
  const muzzle = 16;
  const mx = center.x + Math.cos(c.aimAngle) * muzzle;
  const my = center.y + Math.sin(c.aimAngle) * muzzle;
  const isCrit = stats.critChance > 0 && combatDraw(w) < stats.critChance;
  const dmg = isCrit ? stats.dmg * stats.critMult : stats.dmg;
  w.projectiles.push({
    id: w.nextId++,
    sourceId: c.id,
    type: c.type,
    quality: c.quality,
    combo: c.combo,
    dmg,
    x: center.x,
    y: center.y,
    prevX: center.x,
    prevY: center.y,
    angle: c.aimAngle,
    speed: PROJECTILE_SPEED,
    targetId: target.id,
    splash: stats.splash,
    chain: stats.chainLeaps,
    chainRange: stats.chainRange,
    chainFalloff: stats.chainFalloff,
    slowAmt: stats.slowAmt,
    slowDur: stats.slowDur,
    burnFrac: stats.burnFrac,
    burnDur: stats.burnDur,
    isCrit,
    hitIds: [],
    dead: false,
  });
  // The travelling effect a shot carries: an Emitter throws its spark spray, and every
  // other single-bolt shot draws the arc bolt from the head to the target. A chaining
  // shot draws its forks at the impact and a splashing one its ring, so neither trails
  // a bolt on the way out.
  const family = fireCue(c);
  if (family === "fire-spark") {
    w.fxQueue.push({
      kind: "spray",
      x: mx,
      y: my,
      x2: target.x,
      y2: target.y,
      quality: c.quality,
    });
  } else if (stats.chainLeaps === 0 && stats.splash === 0) {
    w.fxQueue.push({
      kind: "bolt",
      x: mx,
      y: my,
      x2: target.x,
      y2: target.y,
      quality: c.quality,
      big: stats.dmg >= 120,
    });
  }
}

// ---- Shots in flight -----------------------------------------------------

function stepProjectiles(w: FoundryWorld, dt: number): void {
  for (const p of w.projectiles) {
    if (p.dead) continue;
    const target = w.units.find((u) => u.id === p.targetId) ?? null;
    if (!target || target.dead) {
      // The target is gone, so the shot misses and is spent.
      p.dead = true;
      continue;
    }
    const dx = target.x - p.x;
    const dy = target.y - p.y;
    const dist = Math.hypot(dx, dy) || 1;
    const step = p.speed * dt;
    p.angle = Math.atan2(dy, dx);
    if (dist <= PROJECTILE_HIT_R || dist - step <= PROJECTILE_HIT_R) {
      p.x = target.x;
      p.y = target.y;
      p.dead = true;
      onImpact(w, p, target);
    } else {
      p.x += (dx / dist) * step;
      p.y += (dy / dist) * step;
    }
  }
}

function onImpact(w: FoundryWorld, p: Projectile, primary: Unit): void {
  hit(w, p, primary, p.dmg);
  w.fxQueue.push({
    kind: "impact",
    x: p.x,
    y: p.y,
    quality: p.quality,
    big: p.isCrit,
  });

  // A splashing shot deals its full damage to every unit inside the radius.
  if (p.splash > 0) {
    w.fxQueue.push({ kind: "ring", x: p.x, y: p.y, quality: p.quality });
    for (const u of w.units) {
      if (u.dead || p.hitIds.includes(u.id)) continue;
      if (Math.hypot(u.x - p.x, u.y - p.y) <= p.splash) {
        hit(w, p, u, p.dmg);
        w.fxQueue.push({ kind: "impact", x: u.x, y: u.y, quality: p.quality });
      }
    }
  }

  // A chaining shot leaps to the nearest unit it has not struck, each leap carrying a
  // share of the previous hit's damage.
  if (p.chain > 0) {
    let leaps = p.chain;
    let fx = p.x;
    let fy = p.y;
    let dmg = p.dmg;
    while (leaps > 0) {
      let best: Unit | null = null;
      let bestD = Infinity;
      for (const u of w.units) {
        if (u.dead || p.hitIds.includes(u.id)) continue;
        const d = Math.hypot(u.x - fx, u.y - fy);
        if (d <= p.chainRange && d < bestD) {
          bestD = d;
          best = u;
        }
      }
      if (!best) break;
      dmg *= p.chainFalloff;
      w.fxQueue.push({
        kind: "chain",
        x: fx,
        y: fy,
        x2: best.x,
        y2: best.y,
        quality: p.quality,
      });
      hit(w, p, best, dmg);
      w.fxQueue.push({
        kind: "impact",
        x: best.x,
        y: best.y,
        quality: p.quality,
      });
      fx = best.x;
      fy = best.y;
      leaps--;
    }
  }
}

/**
 * Apply one landed shot to one unit, once.
 *
 * The damage and any kill are credited back to the firing structure. The finale's
 * Overload Dynamo cannot die: every shot's full damage is tallied into the Maze Rating
 * instead of removing health, and it still takes a slow and a burn, so a yard that
 * controls it keeps it under fire longer.
 */
function hit(w: FoundryWorld, p: Projectile, u: Unit, dmg: number): void {
  if (u.dead || p.hitIds.includes(u.id)) return;
  p.hitIds.push(u.id);
  u.hitFlash = 0;
  if (u.invincible) {
    tallyRating(w, dmg, p.sourceId);
    if (p.slowAmt > 0) applySlow(w, u, p.slowAmt, p.slowDur);
    if (p.burnFrac > 0)
      applyBurn(w, u, p.dmg * p.burnFrac, p.burnDur, p.sourceId);
    return;
  }
  // Only damage that lands is tallied, never the overkill past zero.
  const applied = Math.min(dmg, Math.max(0, u.hp));
  u.hp -= dmg;
  const src = ownComponent(w, p.sourceId);
  if (src) src.damageDealt += applied;
  if (u.hp <= 0) {
    if (src) src.kills += 1;
    kill(w, u);
    return;
  }
  if (p.slowAmt > 0) applySlow(w, u, p.slowAmt, p.slowDur);
  if (p.burnFrac > 0)
    applyBurn(w, u, p.dmg * p.burnFrac, p.burnDur, p.sourceId);
}

/** Credit damage dealt to the finale's boss: the run's rating, and the tower's tally. */
function tallyRating(w: FoundryWorld, dmg: number, sourceId: number): void {
  w.mazeRating += dmg;
  const src = ownComponent(w, sourceId);
  if (src) src.damageDealt += dmg;
}

/** The strongest active slow wins, and each hit refreshes the duration. */
export function applySlow(
  w: FoundryWorld,
  u: Unit,
  amount: number,
  seconds: number,
): void {
  const active = w.simTime < u.slowUntil ? u.slowFactor : 1;
  u.slowFactor = Math.min(active, 1 - amount);
  u.slowUntil = w.simTime + seconds;
  w.fxQueue.push({ kind: "slow", x: u.x, y: u.y });
  raiseCue(w, "slow");
}

/** The strongest active burn wins, and each hit refreshes the duration. */
export function applyBurn(
  w: FoundryWorld,
  u: Unit,
  dps: number,
  seconds: number,
  sourceId: number,
): void {
  const active = w.simTime < u.burnUntil ? u.burnDps : 0;
  if (dps >= active) {
    u.burnDps = dps;
    u.burnSourceId = sourceId;
  }
  u.burnUntil = w.simTime + seconds;
  w.fxQueue.push({ kind: "burn", x: u.x, y: u.y });
  raiseCue(w, "burn");
}

function kill(w: FoundryWorld, u: Unit): void {
  u.dead = true;
  w.charge += u.bounty;
  w.kills++;
  w.fxQueue.push({ kind: "death", x: u.x, y: u.y, big: u.type === "dynamo" });
  raiseCue(w, "kill");
}

export function unitById(
  w: FoundryView,
  id: number,
): DeepReadonly<Unit> | null {
  for (const u of w.units) if (u.id === id) return u;
  return null;
}

export function componentById(
  w: FoundryView,
  id: number,
): DeepReadonly<Component> | null {
  for (const s of w.structures)
    if (s.id === id && s.kind === "component") return s;
  return null;
}

// ---- Movement and leaks --------------------------------------------------

function stepUnits(w: FoundryWorld, dt: number, occ: Occupancy): void {
  for (const u of w.units) {
    if (u.dead) continue;
    u.animT += dt;
    u.hitFlash += dt;
    if (u.slowFactor < 1 && w.simTime >= u.slowUntil) u.slowFactor = 1;
    if (u.burnDps > 0 && w.simTime < u.burnUntil) {
      const bd = u.burnDps * dt;
      // An ember flare a few times a second, so the burn reads without a flood.
      if (Math.floor(u.animT / 0.25) !== Math.floor((u.animT - dt) / 0.25)) {
        w.fxQueue.push({ kind: "burn", x: u.x, y: u.y });
      }
      if (u.invincible) {
        tallyRating(w, bd, u.burnSourceId);
      } else {
        const applied = Math.min(bd, Math.max(0, u.hp));
        u.hp -= bd;
        const src = ownComponent(w, u.burnSourceId);
        if (src) src.damageDealt += applied;
        if (u.hp <= 0) {
          if (src) src.kills += 1;
          kill(w, u);
          continue;
        }
      }
    } else if (u.burnDps > 0) {
      u.burnDps = 0;
    }
    if (!u.frozen) moveUnit(w, u, dt, occ);
    if (!u.dead) u.progress = remainingTiles(u);
  }
}

function moveUnit(w: FoundryWorld, u: Unit, dt: number, occ: Occupancy): void {
  const b = board(w);
  if (u.route.length === 0) {
    u.route = b.routeFor({ x: u.x, y: u.y }, u.wpIndex, occ, u.flies);
    u.routeStep = 0;
  }
  // A slowed unit covers less ground in the same time.
  let budget = u.speed * u.slowFactor * dt;
  while (budget > 0 && u.routeStep < u.route.length) {
    const target = u.route[u.routeStep]!;
    const dx = target.x - u.x;
    const dy = target.y - u.y;
    const d = Math.hypot(dx, dy);
    if (d <= budget) {
      u.x = target.x;
      u.y = target.y;
      budget -= d;
      u.routeStep++;
    } else {
      u.x += (dx / d) * budget;
      u.y += (dy / d) * budget;
      budget = 0;
    }
  }
  if (u.routeStep >= u.route.length) {
    if (u.wpIndex >= b.chain.length - 1) {
      leak(w, u);
      return;
    }
    u.wpIndex++;
    u.route = b.routeFor({ x: u.x, y: u.y }, u.wpIndex, occ, u.flies);
    u.routeStep = 0;
  }
}

/** The remaining route to the checkpoint the unit is heading for, in tiles. */
function remainingTiles(u: Unit): number {
  let rem = 0;
  let px = u.x;
  let py = u.y;
  for (let i = u.routeStep; i < u.route.length; i++) {
    const p = u.route[i]!;
    rem += Math.hypot(p.x - px, p.y - py);
    px = p.x;
    py = p.y;
  }
  return rem / TILE;
}

/**
 * Whether `a` stands further along the chain than `b`.
 *
 * The checkpoint dominates; among units heading for the same checkpoint the shorter
 * remaining route is further along. `0` puts the two at the same point.
 */
function aheadOf(a: Unit, b: Unit): number {
  if (a.wpIndex !== b.wpIndex) return a.wpIndex > b.wpIndex ? 1 : -1;
  if (a.progress !== b.progress) return a.progress < b.progress ? 1 : -1;
  return 0;
}

function leak(w: FoundryWorld, u: Unit): void {
  u.dead = true;
  const b = board(w);
  const node = b.chain[b.chain.length - 1]!;
  const at = tileCenter(node.col, node.row);
  // The finale's boss grounding out ends the finale and wins the run. It costs no
  // integrity, because the run is already won, and its rating is already tallied.
  if (u.invincible) {
    w.fxQueue.push({ kind: "leak", x: at.x, y: at.y });
    win(w);
    return;
  }
  w.integrity -= u.leak;
  w.leakCount += u.leak;
  w.fxQueue.push({ kind: "leak", x: at.x, y: at.y });
  raiseCue(w, "leak");
}

function cullDead(w: FoundryWorld): void {
  if (w.units.some((u) => u.dead)) w.units = w.units.filter((u) => !u.dead);
  if (w.projectiles.some((p) => p.dead)) {
    w.projectiles = w.projectiles.filter((p) => !p.dead);
  }
}

// ---- The wave ------------------------------------------------------------

function checkWaveEnd(w: FoundryWorld): void {
  const wave = w.activeWave;
  if (!wave) return;
  if (w.spawnCursor >= wave.events.length && w.units.length === 0) endWave(w);
}

function endWave(w: FoundryWorld): void {
  w.activeWave = null;
  w.projectiles = [];
  // The wave's end takes the finale with it. A driver-released Overload Dynamo puts the
  // run into the finale while it is on the yard, and that wave clears the ordinary way,
  // so the phase it clears into is a build phase and not a finale nothing is walking
  // (specs/instrumentation.md). The real finale sets the flag again below.
  w.finale = false;
  // The bonus is a function of the wave number and of nothing else, so it is paid on
  // every wave the run clears, the last one included (specs/economy.md). Building stays
  // available during the finale, so it is Charge the player can still spend.
  w.charge += waveClearBonus(w.wave);
  if (w.wave >= difficulty(w).waves) {
    // The last wave is cleared, so the run is won. Before the victory screen the
    // finale's Overload Dynamo walks the yard once so its damage rates the maze. No
    // build phase follows it.
    startFinale(w);
    return;
  }
  w.phase = "build";
  w.stampsUsed = 0;
  w.harvest = { mode: "none" };
  w.holding = false;
  w.nextWave = buildWave(w.wave + 1, difficulty(w));
}

/**
 * Begin the finale: one invincible Overload Dynamo, walking the yard once.
 *
 * It cannot die, every shot's full damage tallies into the Maze Rating, and when it
 * grounds out the run is won. Building stays disabled and no wave is scheduled, so it
 * simply walks and is shot at.
 */
function startFinale(w: FoundryWorld): void {
  w.finale = true;
  w.phase = "wave";
  w.selectedId = null;
  w.combineIds = [];
  const u = makeUnit(w, "dynamo", occupancyOf(w));
  u.invincible = true;
  // Its bar is drawn full for the whole walk, because its health never falls.
  u.maxHp = u.hp;
  u.radius = loadRadius("overload");
  u.speed = OVERLOAD_SPEED;
  w.units = [u];
  recomputeAuras(w);
}

/**
 * Resolve the level's harvest and start the wave.
 *
 * The kept candidate becomes a permanent firing component and every other candidate
 * hardens into a blocker, so the yard the wave runs against is settled before the first
 * unit is released.
 */
function beginWave(w: FoundryWorld): void {
  resolveHarvest(w);
  w.wave += 1;
  w.phase = "wave";
  w.paused = false;
  w.holding = false;
  w.activeWave = w.nextWave;
  w.spawnerHeld = false;
  w.spawnCursor = 0;
  w.waveClock = 0;
  recomputeAuras(w);
  refreshMaze(w);
  w.nextWave = buildWave(
    Math.min(w.wave + 1, difficulty(w).waves),
    difficulty(w),
  );
}

function resolveHarvest(w: FoundryWorld): void {
  const h = w.harvest;
  if (h.mode === "keep") {
    const cand = candidateById(w, h.id);
    if (cand) promoteToComponent(w, cand);
  }
  let hardened = false;
  for (let i = 0; i < w.structures.length; i++) {
    const s = w.structures[i]!;
    if (s.kind === "candidate") {
      w.structures[i] = { id: s.id, kind: "blocker", col: s.col, row: s.row };
      hardened = true;
    }
  }
  if (hardened) raiseCue(w, "settle");
  w.harvest = { mode: "none" };
}

/** Replace a candidate in place with a firing component of its rolled type and quality. */
function promoteToComponent(w: FoundryWorld, cand: Candidate): void {
  const i = w.structures.findIndex((s) => s.id === cand.id);
  if (i < 0) return;
  const comp = newComponent(
    cand.id,
    cand.type,
    cand.quality,
    cand.col,
    cand.row,
  );
  w.structures[i] = comp;
  const at = footprintCenter(comp.col, comp.row);
  w.fxQueue.push({ kind: "combine", x: at.x, y: at.y, quality: comp.quality });
}

/** A fresh firing component, every field at the value a new structure lands with. */
function newComponent(
  id: number,
  type: ComponentType,
  quality: number,
  col: number,
  row: number,
  targeting: TargetingPriority = DEFAULT_TARGETING,
  combo?: ComboId,
): Component {
  return {
    id,
    kind: "component",
    type,
    quality,
    combo,
    comboLevel: 0,
    col,
    row,
    targeting,
    cooldown: 0,
    // High enough that a new structure is not drawn mid-shot on its first frame.
    fireAnim: 999,
    aimAngle: 0,
    kills: 0,
    damageDealt: 0,
    auraBonus: 0,
  };
}

function win(w: FoundryWorld): void {
  w.finale = false;
  w.screen = "victory";
  w.menuIndex = 0;
  w.units = [];
  w.projectiles = [];
}

function lose(w: FoundryWorld): void {
  w.integrity = 0;
  w.finale = false;
  w.screen = "overload";
  w.menuIndex = 0;
  w.units = [];
  w.projectiles = [];
  w.activeWave = null;
}

// ---- The scrap-press -----------------------------------------------------

export function stampsLeft(w: FoundryView): number {
  return Math.max(0, STAMPS_PER_LEVEL - w.stampsUsed);
}

/** The press may be pulled in a build phase, with a stamp of the allowance left. */
export function canStamp(w: FoundryView): boolean {
  return (
    w.screen === "playing" &&
    w.phase === "build" &&
    !w.holding &&
    stampsLeft(w) > 0
  );
}

/** Pull the press: a blank rock is armed on the cursor. It rolls when it lands. */
export function pullPress(w: FoundryWorld): boolean {
  if (!canStamp(w)) return false;
  w.holding = true;
  raiseCue(w, "stamp");
  return true;
}

/** The type roll: every base type equally likely, whatever the refinement. */
function rollType(w: FoundryWorld): ComponentType {
  let r = pressDraw(w);
  for (const type of COMPONENT_TYPES) {
    r -= TYPE_ROLL_ODDS;
    if (r <= 0) return type;
  }
  return COMPONENT_TYPES[COMPONENT_TYPES.length - 1]!;
}

/** The quality roll, on the odds the current refinement level gives. */
function rollQuality(w: FoundryWorld): number {
  const odds = REFINEMENT_ODDS[w.refinement]!;
  let r = pressDraw(w);
  for (let q = 1; q <= MAX_QUALITY; q++) {
    r -= odds[q - 1]!;
    if (r <= 0) return q;
  }
  return 1;
}

/** The blocker whose footprint is exactly this anchor, which a rock would reroll. */
function blockerAtAnchor(
  w: FoundryView,
  col: number,
  row: number,
): DeepReadonly<Blocker> | null {
  for (const s of w.structures) {
    if (s.kind === "blocker" && s.col === col && s.row === row) return s;
  }
  return null;
}

/** Where a rock may land: a legal empty footprint, or exactly onto a blocker. */
export function canPlaceAt(w: FoundryView, col: number, row: number): boolean {
  if (w.screen !== "playing" || w.phase !== "build") return false;
  if (blockerAtAnchor(w, col, row)) return true;
  return board(w).canPlace(col, row, w.structures, w.units);
}

/**
 * Drop a rock at an anchor.
 *
 * The roll happens here rather than when the press was pulled: a random type on the
 * uniform odds and a quality on the refinement's, or exactly what the surface armed.
 * It spends one stamp, costs no Charge, walls its footprint, and re-paths the floor.
 * Dropping onto a blocker rerolls that blocker in place. Another rock is armed
 * immediately afterward if the allowance still permits.
 */
export function placeStamp(
  w: FoundryWorld,
  col: number,
  row: number,
): Candidate | null {
  if (w.screen !== "playing" || w.phase !== "build") return null;
  if (!w.holding && !canStamp(w)) return null;
  if (stampsLeft(w) <= 0) return null;
  const onBlocker = blockerAtAnchor(w, col, row);
  if (!onBlocker && !board(w).canPlace(col, row, w.structures, w.units)) {
    // An illegal spot: the rock stays on the cursor and nothing is spent.
    return null;
  }
  if (onBlocker)
    w.structures = w.structures.filter((s) => s.id !== onBlocker.id);
  w.stampsUsed += 1;
  const armed = w.armedRoll;
  w.armedRoll = null;
  const cand: Candidate = {
    id: w.nextId++,
    kind: "candidate",
    type: armed ? armed.type : rollType(w),
    quality: armed ? armed.quality : rollQuality(w),
    col,
    row,
  };
  w.structures.push(cand);
  w.selectedId = cand.id;
  w.combineIds = [cand.id];
  // Continuous placement: the rock is released, then another is armed if the allowance
  // still permits. `canStamp` requires an empty hand, so the release must come first.
  w.holding = false;
  w.holding = canStamp(w);
  rePath(w);
  const at = footprintCenter(col, row);
  w.fxQueue.push({ kind: "build", x: at.x, y: at.y, quality: cand.quality });
  raiseCue(w, "stamp");
  return cand;
}

/** Put a held rock away. Nothing was rolled and nothing was spent. */
export function cancelHeld(w: FoundryWorld): void {
  w.holding = false;
}

// ---- Dismantle -----------------------------------------------------------

export function canRemove(w: FoundryView, id: number): boolean {
  if (w.screen !== "playing" || w.phase !== "build") return false;
  return w.structures.some((s) => s.id === id);
}

/**
 * Clear a structure's footprint and re-path.
 *
 * It never returns the stamp: a refund would let a player place a rock, reject its
 * roll, dismantle it, and roll again without limit. A dismantle only ever opens routes,
 * so it can never seal the yard.
 */
export function removeStructure(w: FoundryWorld, id: number): boolean {
  if (w.screen !== "playing" || w.phase !== "build") return false;
  const i = w.structures.findIndex((s) => s.id === id);
  if (i < 0) return false;
  if (w.harvest.mode === "keep" && w.harvest.id === id)
    w.harvest = { mode: "none" };
  w.structures.splice(i, 1);
  if (w.selectedId === id) w.selectedId = null;
  const at = w.combineIds.indexOf(id);
  if (at >= 0) w.combineIds.splice(at, 1);
  rePath(w);
  return true;
}

export function removeSelected(w: FoundryWorld): void {
  if (w.selectedId !== null) removeStructure(w, w.selectedId);
}

// ---- Harvest and combining -----------------------------------------------

export function candidateById(
  w: FoundryView,
  id: number,
): DeepReadonly<Candidate> | null {
  const s = w.structures.find((x) => x.id === id);
  return s && s.kind === "candidate" ? s : null;
}

export function candidates(w: FoundryView): DeepReadonly<Candidate>[] {
  return w.structures.filter(
    (s): s is DeepReadonly<Candidate> => s.kind === "candidate",
  );
}

/** A structure usable as a combine ingredient: it carries a type and a quality. */
export function baseStructureById(
  w: FoundryView,
  id: number,
): DeepReadonly<Candidate | Component> | null {
  const s = w.structures.find((x) => x.id === id);
  if (!s) return null;
  if (s.kind === "candidate") return s;
  if (s.kind === "component" && !s.combo) return s;
  return null;
}

/**
 * Harvest a candidate as this level's permanent component, which launches the wave.
 *
 * A harvest is the wave trigger, so there is no separate send: place and compare every
 * rock first, then commit the one to keep.
 */
export function keep(w: FoundryWorld, id: number): boolean {
  // A control the player operates is refused wherever that control is refused, and the
  // pause menu takes the input: on `paused` every control on the yard is inert
  // (specs/controls.md).
  if (w.screen !== "playing") return false;
  if (w.phase !== "build") return false;
  if (!candidateById(w, id)) return false;
  w.harvest = { mode: "keep", id };
  beginWave(w);
  return true;
}

export function keepSelected(w: FoundryWorld): void {
  const s = selected(w);
  if (s && s.kind === "candidate") keep(w, s.id);
}

/** Whether a candidate may be harvested one rung lower. */
export function canDowngrade(w: FoundryView, id: number): boolean {
  if (w.screen !== "playing" || w.phase !== "build") return false;
  const cand = candidateById(w, id);
  return !!cand && cand.quality > 1;
}

/**
 * Harvest a candidate one quality rung lower.
 *
 * Refining biases rolls upward, which can leave a player unable to produce the low-rung
 * ingredient a recipe still needs. This is a keep at one rung lower, so like a keep it
 * is the level's harvest and it launches the wave.
 */
export function downgrade(w: FoundryWorld, id: number): boolean {
  if (!canDowngrade(w, id)) return false;
  const cand = ownCandidate(w, id)!;
  cand.quality -= 1;
  const at = footprintCenter(cand.col, cand.row);
  w.fxQueue.push({ kind: "build", x: at.x, y: at.y, quality: cand.quality });
  w.harvest = { mode: "keep", id };
  beginWave(w);
  return true;
}

export function downgradeSelected(w: FoundryWorld): void {
  if (w.selectedId !== null) downgrade(w, w.selectedId);
}

/** Whether a same-type, same-quality partner exists, so a quality fold is offered. */
export function canCombine(
  w: FoundryView,
  c: DeepReadonly<Candidate | Component>,
): boolean {
  return c.quality < MAX_QUALITY && combinePartnerOf(w, c) !== null;
}

/**
 * The partner a quality fold would take, preferring a candidate to a standing
 * structure, so an untargeted combine spends this phase's rolls before it eats a
 * structure already invested in.
 */
export function combinePartnerOf(
  w: FoundryView,
  c: DeepReadonly<Candidate | Component>,
): DeepReadonly<Candidate | Component> | null {
  if (c.quality >= MAX_QUALITY) return null;
  let standing: DeepReadonly<Component> | null = null;
  for (const s of w.structures) {
    if (s.id === c.id) continue;
    if (s.kind === "candidate") {
      if (s.type === c.type && s.quality === c.quality) return s;
    } else if (s.kind === "component" && !s.combo && standing === null) {
      if (s.type === c.type && s.quality === c.quality) standing = s;
    }
  }
  return standing;
}

/** The explicit combine set: the primary first, then the added structures. */
export function combineSet(w: FoundryView): number[] {
  const ids: number[] = [];
  const push = (id: number | null): void => {
    if (id === null) return;
    if (ids.includes(id)) return;
    if (baseStructureById(w, id)) ids.push(id);
  };
  for (const id of w.combineIds) push(id);
  return ids;
}

/**
 * Fold a matching pair one quality rung higher, landing at the initiator's footprint.
 *
 * The partner is consumed but its footprint hardens into a blocker, so a combine never
 * opens a hole in the yard. A fold that consumes a candidate placed this phase consumes
 * the phase's harvest, so it launches the wave.
 */
function combineQualityNow(
  w: FoundryWorld,
  anchorId: number,
  partnerId: number,
): boolean {
  if (w.screen !== "playing") return false;
  const anchor = baseStructureById(w, anchorId);
  const partner = baseStructureById(w, partnerId);
  if (!anchor || !partner || anchor.id === partner.id) return false;
  if (anchor.quality >= MAX_QUALITY) return false;
  if (partner.type !== anchor.type || partner.quality !== anchor.quality)
    return false;

  const consumedFreshRoll =
    anchor.kind === "candidate" || partner.kind === "candidate";
  const pIdx = w.structures.findIndex((s) => s.id === partner.id);
  if (pIdx >= 0) {
    w.structures[pIdx] = {
      id: partner.id,
      kind: "blocker",
      col: partner.col,
      row: partner.row,
    };
  }
  const comp = newComponent(
    anchor.id,
    anchor.type,
    anchor.quality + 1,
    anchor.col,
    anchor.row,
    anchor.kind === "component" ? anchor.targeting : DEFAULT_TARGETING,
  );
  const i = w.structures.findIndex((s) => s.id === anchor.id);
  if (i >= 0) w.structures[i] = comp;
  else w.structures.push(comp);
  w.selectedId = comp.id;
  w.combineIds = [comp.id];
  rePath(w);
  const at = footprintCenter(comp.col, comp.row);
  w.fxQueue.push({ kind: "combine", x: at.x, y: at.y, quality: comp.quality });
  raiseCue(w, "combine");
  if (consumedFreshRoll && w.phase === "build") {
    // The fold is the phase's sole harvest, so it discards any marked keep.
    w.harvest = { mode: "none" };
    beginWave(w);
  }
  return true;
}

/**
 * Fold an exact multiset of ingredients into a combination tower, landing at the
 * initiator's footprint at upgrade level `0`.
 *
 * Every other consumed ingredient hardens into a blocker in place, so the fold is
 * wall-neutral. As with a quality fold, consuming a candidate placed this phase makes it
 * the phase's harvest.
 */
function combineRecipeNow(
  w: FoundryWorld,
  anchorId: number,
  combo: ComboId,
  ingredientIds: readonly number[],
): boolean {
  if (w.screen !== "playing") return false;
  const anchor = baseStructureById(w, anchorId);
  if (!anchor || !ingredientIds.includes(anchorId)) return false;
  if (!recipeSatisfied(w, combo, ingredientIds)) return false;

  const consumedFreshRoll = ingredientIds.some(
    (id) => candidateById(w, id) !== null,
  );
  for (const id of ingredientIds) {
    if (id === anchor.id) continue;
    const idx = w.structures.findIndex((s) => s.id === id);
    if (idx >= 0) {
      const s = w.structures[idx]!;
      w.structures[idx] = { id: s.id, kind: "blocker", col: s.col, row: s.row };
    }
  }
  const comp = newComponent(
    anchor.id,
    // The tower's mount takes an ingredient's tint; it drives nothing else.
    anchor.type,
    // A sentinel: a tower's power axis is its upgrade level, never a quality rung.
    MAX_QUALITY,
    anchor.col,
    anchor.row,
    DEFAULT_TARGETING,
    combo,
  );
  const i = w.structures.findIndex((s) => s.id === anchor.id);
  if (i >= 0) w.structures[i] = comp;
  else w.structures.push(comp);
  w.selectedId = comp.id;
  w.combineIds = [comp.id];
  rePath(w);
  const at = footprintCenter(comp.col, comp.row);
  w.fxQueue.push({
    kind: "combine",
    x: at.x,
    y: at.y,
    quality: MAX_QUALITY,
    big: true,
  });
  raiseCue(w, "combine");
  if (consumedFreshRoll && w.phase === "build") {
    w.harvest = { mode: "none" };
    beginWave(w);
  }
  return true;
}

/**
 * Commit a combine from the current selection.
 *
 * With an explicit set of two or more, fold exactly that set: a matching pair climbs a
 * rung, an exact recipe multiset assembles its tower, and either lands at the primary.
 * With one selected, resolve it: fold the quality pair the game picks, or else assemble
 * the one reachable recipe.
 */
export function combineSelection(w: FoundryWorld): boolean {
  const set = combineSet(w);
  // An emptied set is no explicit set, so the ingredients are the game's to resolve
  // from whatever is selected (specs/scrap-press.md).
  const anchor = set.length > 0 ? set[0]! : w.selectedId;
  if (anchor === null) return false;
  if (set.length >= 2) {
    if (set.length === 2) {
      const a = baseStructureById(w, set[0]!)!;
      const b = baseStructureById(w, set[1]!)!;
      if (
        a.quality < MAX_QUALITY &&
        a.type === b.type &&
        a.quality === b.quality
      ) {
        return combineQualityNow(w, anchor, set[1]!);
      }
    }
    const combo = comboMatching(w, set);
    if (combo) return combineRecipeNow(w, anchor, combo, set);
    return false;
  }
  const base = baseStructureById(w, anchor);
  if (!base) return false;
  const partner = combinePartnerOf(w, base);
  if (partner) return combineQualityNow(w, anchor, partner.id);
  const recipes = reachableCombos(w, base);
  if (recipes.length >= 1) {
    return combineRecipeNow(
      w,
      anchor,
      recipes[0]!.combo,
      recipes[0]!.ingredientIds,
    );
  }
  return false;
}

/** The tower an explicit ingredient set assembles, or `null`. */
function comboMatching(w: FoundryView, ids: readonly number[]): ComboId | null {
  const keys: string[] = [];
  const seen = new Set<number>();
  for (const id of ids) {
    if (seen.has(id)) return null;
    seen.add(id);
    const s = w.structures.find((x) => x.id === id);
    const k = s ? ingredientKeyOf(s) : null;
    if (!k) return null;
    keys.push(k);
  }
  const key = keys.sort().join(",");
  for (const combo of COMBOS)
    if (recipeKey(combo.recipe) === key) return combo.id;
  return null;
}

/** A structure's ingredient key, or `null` when it can never be an ingredient. */
function ingredientKeyOf(s: DeepReadonly<Structure>): string | null {
  if (s.kind === "candidate") return `${s.type}@${s.quality}`;
  if (s.kind === "component" && !s.combo) return `${s.type}@${s.quality}`;
  return null;
}

/**
 * Every recipe the yard can satisfy with this structure as one ingredient, each with a
 * concrete set of ingredient identities, the initiator first.
 *
 * The remaining ingredients are picked candidate-first, so an untargeted recipe spends
 * this phase's rolls before it eats standing structures.
 */
export function reachableCombos(
  w: FoundryView,
  anchor: DeepReadonly<Candidate | Component>,
): { combo: ComboId; ingredientIds: number[] }[] {
  const anchorKey = `${anchor.type}@${anchor.quality}`;
  const avail = new Map<string, number[]>();
  for (const s of w.structures) {
    const k = ingredientKeyOf(s);
    if (!k) continue;
    if (!avail.has(k)) avail.set(k, []);
    avail.get(k)!.push(s.id);
  }
  for (const list of avail.values()) {
    list.sort(
      (a, b) => (candidateById(w, b) ? 1 : 0) - (candidateById(w, a) ? 1 : 0),
    );
  }
  const out: { combo: ComboId; ingredientIds: number[] }[] = [];
  for (const combo of COMBOS) {
    const need = new Map<string, number>();
    for (const ing of combo.recipe) {
      const k = `${ing.type}@${ing.tier}`;
      need.set(k, (need.get(k) ?? 0) + 1);
    }
    if (!need.has(anchorKey)) continue;
    let ok = true;
    for (const [k, count] of need) {
      if ((avail.get(k)?.length ?? 0) < count) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    const ids: number[] = [];
    for (const [k, count] of need) {
      let list = avail.get(k)!.slice();
      if (k === anchorKey)
        list = [anchor.id, ...list.filter((id) => id !== anchor.id)];
      for (let i = 0; i < count; i++) ids.push(list[i]!);
    }
    out.push({ combo: combo.id, ingredientIds: ids });
  }
  return out;
}

/** The reachable recipes for a structure identity, empty unless it is a base structure. */
export function reachableCombosFor(
  w: FoundryView,
  id: number,
): { combo: ComboId; ingredientIds: number[] }[] {
  const base = baseStructureById(w, id);
  return base ? reachableCombos(w, base) : [];
}

/** Whether a set of identities still exactly matches a recipe's multiset. */
function recipeSatisfied(
  w: FoundryView,
  combo: ComboId,
  ingredientIds: readonly number[],
): boolean {
  const seen = new Set<number>();
  const keys: string[] = [];
  for (const id of ingredientIds) {
    if (seen.has(id)) return false;
    seen.add(id);
    const s = w.structures.find((x) => x.id === id);
    if (!s) return false;
    const k = ingredientKeyOf(s);
    if (!k) return false;
    keys.push(k);
  }
  return keys.sort().join(",") === recipeKey(COMBO_BY_ID[combo].recipe);
}

/**
 * Assemble a named tower from an initiator.
 *
 * An explicit combine set that exactly satisfies this recipe spends those copies, so a
 * player chooses which duplicates fold; otherwise the ingredients are picked from the
 * yard.
 */
export function combineRecipe(
  w: FoundryWorld,
  id: number,
  combo: ComboId,
): boolean {
  const base = baseStructureById(w, id);
  if (!base) return false;
  const set = combineSet(w);
  if (set.length >= 2 && set[0] === id && comboMatching(w, set) === combo) {
    return combineRecipeNow(w, id, combo, set);
  }
  const option = reachableCombos(w, base).find((o) => o.combo === combo);
  if (!option) return false;
  return combineRecipeNow(w, id, combo, option.ingredientIds);
}

export function combineRecipeSelected(
  w: FoundryWorld,
  combo: ComboId,
): boolean {
  return w.selectedId !== null ? combineRecipe(w, w.selectedId, combo) : false;
}

export function combineSelected(w: FoundryWorld): boolean {
  return combineSelection(w);
}

/** Commit a combine from an initiator, as the surface's `combine` does. */
export function combineFrom(w: FoundryWorld, id: number): boolean {
  const set = combineSet(w);
  if (set.length >= 2 && set[0] === id) return combineSelection(w);
  select(w, id);
  return combineSelection(w);
}

// ---- Refinement ----------------------------------------------------------

export function refineCost(w: FoundryView): number | null {
  return refinementCost(w.refinement);
}

/**
 * Refining is allowed in any phase: it only biases future rolls, so there is no reason
 * to close it during a live wave, and it keeps a Charge sink open while one runs.
 */
export function canUpgradeQuality(w: FoundryView): boolean {
  const cost = refineCost(w);
  return w.screen === "playing" && cost !== null && w.charge >= cost;
}

export function upgradeQuality(w: FoundryWorld): boolean {
  const cost = refineCost(w);
  if (!canUpgradeQuality(w) || cost === null) return false;
  w.charge -= cost;
  w.refinement = Math.min(REFINEMENT_MAX, w.refinement + 1);
  return true;
}

// ---- Combination-tower upgrades ------------------------------------------

export function comboUpgradeCostFor(c: DeepReadonly<Component>): number | null {
  return c.combo ? comboUpgradeCost(c.combo, c.comboLevel) : null;
}

export function canUpgradeCombo(w: FoundryView, id: number): boolean {
  if (w.screen !== "playing") return false;
  const s = w.structures.find((x) => x.id === id);
  if (!s || s.kind !== "component" || !s.combo) return false;
  const cost = comboUpgradeCost(s.combo, s.comboLevel);
  return cost !== null && w.charge >= cost;
}

export function upgradeCombo(w: FoundryWorld, id: number): boolean {
  if (!canUpgradeCombo(w, id)) return false;
  const s = ownComponent(w, id)!;
  const cost = comboUpgradeCost(s.combo!, s.comboLevel)!;
  w.charge -= cost;
  s.comboLevel = Math.min(COMBO_MAX_LEVEL, s.comboLevel + 1);
  if (comboStats(s.combo!, s.comboLevel).auraRadius > 0) recomputeAuras(w);
  raiseCue(w, "combine");
  const at = footprintCenter(s.col, s.row);
  w.fxQueue.push({
    kind: "combine",
    x: at.x,
    y: at.y,
    quality: MAX_QUALITY,
    big: true,
  });
  return true;
}

export function upgradeComboSelected(w: FoundryWorld): void {
  if (w.selectedId !== null) upgradeCombo(w, w.selectedId);
}

// ---- Targeting -----------------------------------------------------------

export function setTargeting(c: Component, priority: TargetingPriority): void {
  c.targeting = priority;
}

export function cycleTargeting(c: Component): void {
  const i = TARGETING_PRIORITIES.indexOf(c.targeting);
  c.targeting = TARGETING_PRIORITIES[(i + 1) % TARGETING_PRIORITIES.length]!;
}

export function cycleTargetingSelected(w: FoundryWorld): void {
  if (w.screen !== "playing") return;
  if (w.selectedId === null) return;
  const c = ownComponent(w, w.selectedId);
  if (c) cycleTargeting(c);
}

export function setTargetingById(
  w: FoundryWorld,
  id: number,
  priority: TargetingPriority,
): void {
  if (w.screen !== "playing") return;
  const c = ownComponent(w, id);
  if (c) setTargeting(c, priority);
}

// ---- Selection -----------------------------------------------------------

export function select(w: FoundryWorld, id: number | null): void {
  w.selectedId = id;
  // A plain select clears the combine set back to that single selection
  // (specs/instrumentation.md), and clearing the selection empties it.
  w.combineIds = id === null ? [] : [id];
}

/**
 * Select what stands at a logical position, or, with `additive`, toggle it in the
 * explicit combine set. The primary stays the inspector's subject.
 */
export function selectAt(
  w: FoundryWorld,
  x: number,
  y: number,
  additive = false,
): void {
  const s = structureAt(w, x, y);
  if (!additive) {
    w.selectedId = s ? s.id : null;
    w.combineIds = s ? [s.id] : [];
    return;
  }
  if (!s) return;
  if (w.selectedId === null) {
    w.selectedId = s.id;
    w.combineIds = [s.id];
    return;
  }
  if (s.id === w.selectedId) return;
  const i = w.combineIds.indexOf(s.id);
  if (i >= 0) w.combineIds.splice(i, 1);
  else if (baseStructureById(w, s.id)) w.combineIds.push(s.id);
}

/** Add a structure to the explicit combine set, or remove it when it is already in. */
export function addToCombineSet(w: FoundryWorld, id: number): void {
  if (w.selectedId === null) {
    w.selectedId = id;
    w.combineIds = [id];
    return;
  }
  if (w.selectedId === id) return;
  const at = w.combineIds.indexOf(id);
  if (at >= 0) w.combineIds.splice(at, 1);
  else w.combineIds.push(id);
}

/**
 * Empty the explicit combine set, leaving the selection as it is.
 *
 * The set is state of its own rather than a projection of the selection, so an emptied
 * set reads empty while a structure is still selected, and the game then resolves a
 * combine's ingredients itself (specs/scrap-press.md).
 */
export function clearCombineSet(w: FoundryWorld): void {
  w.combineIds = [];
}

export function structureAt(
  w: FoundryView,
  x: number,
  y: number,
): DeepReadonly<Structure> | null {
  const t = board(w).pixelToTile(x, y);
  for (const s of w.structures) {
    if (
      t.col >= s.col &&
      t.col <= s.col + 1 &&
      t.row >= s.row &&
      t.row <= s.row + 1
    ) {
      return s;
    }
  }
  return null;
}

export function selected(w: FoundryView): DeepReadonly<Structure> | null {
  if (w.selectedId === null) return null;
  return w.structures.find((s) => s.id === w.selectedId) ?? null;
}

/** The explicitly added structures that still exist, for the renderer. */
export function extraSelected(w: FoundryView): DeepReadonly<Structure>[] {
  const out: DeepReadonly<Structure>[] = [];
  for (const id of w.combineIds) {
    if (id === w.selectedId) continue;
    const s = w.structures.find((x) => x.id === id);
    if (s) out.push(s);
  }
  return out;
}

// ---- The wave, as the HUD reads it ---------------------------------------

export function currentWave(w: FoundryView): Wave {
  return w.activeWave ?? w.nextWave;
}

export function nextWavePreview(w: FoundryView): Wave {
  return w.nextWave;
}

export function waveProgress(w: FoundryView): number {
  const wave = w.activeWave;
  if (!wave || wave.events.length === 0) return 0;
  return Math.min(1, w.spawnCursor / wave.events.length);
}

/** The dev launcher for a wave. No control is wired to it; a harvest starts a wave. */
export function startWave(w: FoundryWorld): void {
  if (w.screen !== "playing" || w.phase !== "build") return;
  w.holding = false;
  beginWave(w);
}

// ---- What a combine would fold, for the renderer -------------------------

/**
 * What folds together if a combine is committed now.
 *
 * With an explicit set of two or more those exact pieces are marked as committed. With
 * one base structure selected, every piece it could fold with is marked: its quality
 * partner and every ingredient of every recipe it reaches.
 */
export function combineHighlight(w: FoundryView): {
  primaryId: number | null;
  partnerIds: Set<number>;
  committed: boolean;
} {
  const partnerIds = new Set<number>();
  const set = combineSet(w);
  if (set.length >= 2) {
    for (let i = 1; i < set.length; i++) partnerIds.add(set[i]!);
    return { primaryId: set[0]!, partnerIds, committed: true };
  }
  const sel = selected(w);
  if (
    sel &&
    (sel.kind === "candidate" || (sel.kind === "component" && !sel.combo))
  ) {
    const partner = combinePartnerOf(w, sel);
    if (partner) partnerIds.add(partner.id);
    for (const rec of reachableCombos(w, sel)) {
      for (const id of rec.ingredientIds) if (id !== sel.id) partnerIds.add(id);
    }
    return { primaryId: sel.id, partnerIds, committed: false };
  }
  return { primaryId: null, partnerIds, committed: false };
}

/**
 * Every base structure that could fold into some combine right now.
 *
 * The renderer pulses these at all times rather than only when one is selected, so a
 * player is told which pieces can fold without having to ask.
 */
export function combinablePieces(w: FoundryView): Set<number> {
  const ids = new Set<number>();
  for (const s of w.structures) {
    if (s.kind !== "candidate" && !(s.kind === "component" && !s.combo))
      continue;
    const base = s as DeepReadonly<Candidate | Component>;
    if (
      combinePartnerOf(w, base) !== null ||
      reachableCombos(w, base).length > 0
    ) {
      ids.add(base.id);
    }
  }
  return ids;
}

// ---- Speed, pause, and the screens ---------------------------------------

export function cycleSpeed(w: FoundryWorld): void {
  w.speed = w.speed === 1 ? 2 : w.speed === 2 ? 4 : w.speed === 4 ? 8 : 1;
}

export function setSpeed(w: FoundryWorld, multiplier: Speed): void {
  w.speed = multiplier;
}

export function togglePause(w: FoundryWorld): void {
  if (w.screen === "playing") w.paused = !w.paused;
}

export function setPaused(w: FoundryWorld, paused: boolean): void {
  w.paused = paused;
}

export function setScreen(w: FoundryWorld, screen: ScreenName): void {
  w.screen = screen;
  w.menuIndex = 0;
}

export function setMenuIndex(w: FoundryWorld, index: number): void {
  w.menuIndex = index;
}

export function setOverlay(
  w: FoundryWorld,
  overlay: "combos" | "damage",
  open: boolean,
): void {
  if (overlay === "combos") w.showCombos = open;
  else w.showDamage = open;
}

/** The map the next run opens on. The chain a snapshot reports is its from now. */
export function setMap(w: FoundryWorld, map: MapId): void {
  w.mapId = map;
  refreshMaze(w);
}

export function setDifficulty(w: FoundryWorld, id: DifficultyId): void {
  w.difficultyId = id;
  w.nextWave = buildWave(Math.max(1, w.wave + 1), difficulty(w));
}

// ---- Resources and progress ----------------------------------------------

export function setCharge(w: FoundryWorld, amount: number): void {
  w.charge = amount;
}

/** Grid Integrity resolves no defeat by itself; the rules resolve on the next advance. */
export function setIntegrity(w: FoundryWorld, amount: number): void {
  w.integrity = amount;
  w.maxIntegrity = Math.max(w.maxIntegrity, amount);
}

export function setRefinement(w: FoundryWorld, level: number): void {
  w.refinement = level;
}

/** The wave units released from now on scale to. */
export function setWave(w: FoundryWorld, n: number): void {
  w.wave = n;
  w.nextWave = buildWave(
    Math.max(1, Math.min(n + 1, difficulty(w).waves)),
    difficulty(w),
  );
}

export function setStamps(w: FoundryWorld, n: number): void {
  w.stampsUsed = STAMPS_PER_LEVEL - n;
}

// ---- Standing structures up directly -------------------------------------

/** Remove everything from the yard, reopen its tiles, and recompute the route. */
export function clearStructures(w: FoundryWorld): void {
  w.structures = [];
  w.selectedId = null;
  w.combineIds = [];
  w.harvest = { mode: "none" };
  rePath(w);
}

export function armNextRoll(
  w: FoundryWorld,
  type: ComponentType,
  quality: number,
): void {
  w.armedRoll = { type, quality };
}

export function clearNextRoll(w: FoundryWorld): void {
  w.armedRoll = null;
}

/**
 * Stand a permanent firing component up at an anchor.
 *
 * It spends no stamp, consumes no harvest, costs no Charge, and starts no wave, and it
 * is subject to the same placement conditions and the same never-seal rule a rock is.
 */
export function placeComponent(
  w: FoundryWorld,
  type: ComponentType,
  quality: number,
  col: number,
  row: number,
): Component | null {
  if (!board(w).canPlace(col, row, w.structures, w.units)) return null;
  const comp = newComponent(w.nextId++, type, quality, col, row);
  w.structures.push(comp);
  rePath(w);
  return comp;
}

/** Stand a combination tower up at an anchor, at upgrade level `0`. */
export function placeCombo(
  w: FoundryWorld,
  combo: ComboId,
  col: number,
  row: number,
): Component | null {
  if (!board(w).canPlace(col, row, w.structures, w.units)) return null;
  const comp = newComponent(
    w.nextId++,
    COMBO_BY_ID[combo].recipe[0]!.type,
    MAX_QUALITY,
    col,
    row,
    DEFAULT_TARGETING,
    combo,
  );
  w.structures.push(comp);
  rePath(w);
  return comp;
}

/** Stand an inert blocker up at an anchor. */
export function placeBlocker(
  w: FoundryWorld,
  col: number,
  row: number,
): Blocker | null {
  if (!board(w).canPlace(col, row, w.structures, w.units)) return null;
  const b: Blocker = { id: w.nextId++, kind: "blocker", col, row };
  w.structures.push(b);
  rePath(w);
  return b;
}

export function setComboLevel(
  w: FoundryWorld,
  id: number,
  level: number,
): void {
  const c = ownComponent(w, id);
  if (c) c.comboLevel = level;
}

// ---- The Load, posed -----------------------------------------------------

/** Remove every live unit. None is killed and none leaks. */
export function clearUnits(w: FoundryWorld): void {
  w.units = [];
}

/** Remove every shot in flight without applying its damage or crediting a tally. */
export function clearProjectiles(w: FoundryWorld): void {
  w.projectiles = [];
}

/**
 * Release one unit at the map's entry through the real spawner.
 *
 * This engages the hold on the spawner: the run enters a live wave whose schedule is
 * empty, so the units on the yard are exactly the ones released this way, and that wave
 * clears the ordinary way once they have all died or leaked.
 */
export function spawnUnit(
  w: FoundryWorld,
  type: LoadType | "overload",
): Unit | null {
  if (w.screen !== "playing") return null;
  if (w.phase === "build") {
    w.phase = "wave";
    w.harvest = { mode: "none" };
    w.holding = false;
  }
  holdSpawner(w);
  recomputeAuras(w);
  const u = makeUnit(w, type === "overload" ? "dynamo" : type, occupancyOf(w));
  if (type === "overload") {
    u.invincible = true;
    u.maxHp = u.hp;
    u.radius = loadRadius("overload");
    u.speed = OVERLOAD_SPEED;
    w.finale = true;
  }
  w.units.push(u);
  return u;
}

/** The hold itself: a live wave with an empty schedule, which still clears. */
function holdSpawner(w: FoundryWorld): void {
  if (w.spawnerHeld && w.activeWave) return;
  w.spawnerHeld = true;
  w.activeWave = {
    wave: w.wave,
    events: [],
    durationMs: 0,
    types: [],
    hasBoss: false,
    hasAir: false,
  };
  w.spawnCursor = 0;
  w.waveClock = 0;
}

/**
 * Move a unit to a logical position and leave it there.
 *
 * Its health, its statuses, and the checkpoint it is heading for are untouched, so its
 * route is re-solved from where it now stands to the checkpoint it was already heading
 * for.
 */
export function setUnitPosition(
  w: FoundryWorld,
  u: Unit,
  x: number,
  y: number,
): void {
  u.x = x;
  u.y = y;
  u.prevX = x;
  u.prevY = y;
  u.route = board(w).routeFor({ x, y }, u.wpIndex, occupancyOf(w), u.flies);
  u.routeStep = 0;
  u.progress = remainingTiles(u);
}

/** Set the checkpoint a unit is heading for. It moves the unit nowhere. */
export function setUnitWaypoint(w: FoundryWorld, u: Unit, index: number): void {
  u.wpIndex = index;
  u.route = board(w).routeFor(
    { x: u.x, y: u.y },
    u.wpIndex,
    occupancyOf(w),
    u.flies,
  );
  u.routeStep = 0;
  u.progress = remainingTiles(u);
}

/** Set a unit's health. The maximum never changes, so its bar reads the fraction. */
export function setUnitHp(u: Unit, hp: number): void {
  u.hp = hp;
}

export function setUnitFrozen(u: Unit, frozen: boolean): void {
  u.frozen = frozen;
}

// ---- Lookups an argument is validated against ----------------------------

export function structureById(
  w: FoundryView,
  id: number,
): DeepReadonly<Structure> | null {
  return w.structures.find((s) => s.id === id) ?? null;
}

export function liveUnitById(
  w: FoundryView,
  id: number,
): DeepReadonly<Unit> | null {
  const u = unitById(w, id);
  return u && !u.dead ? u : null;
}

export function comboById(
  w: FoundryView,
  id: number,
): DeepReadonly<Component> | null {
  const c = componentById(w, id);
  return c && c.combo ? c : null;
}

export function firingStructureById(
  w: FoundryView,
  id: number,
): DeepReadonly<Component> | null {
  const c = componentById(w, id);
  return c && unbuffedStats(c).fires ? c : null;
}

/**
 * The phase as `specs/instrumentation.md` reports it, or `null` off the yard.
 *
 * The yard is shown on `playing` and `paused`, so a run frozen behind the pause menu is
 * still in the phase it was in, and only a screen with no yard reports none.
 */
export function reportedPhase(w: FoundryView): PhaseName | null {
  if (w.screen !== "playing" && w.screen !== "paused") return null;
  return w.finale ? "finale" : w.phase;
}
