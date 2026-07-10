/**
 * Sunfront — the headless simulation core (specs/economy.md, units.md, waves.md,
 * playfield.md).
 *
 * This is the game, with no renderer, no THREE, and no DOM: a pure, frame-rate
 * independent model of the tug-of-war on the logical `(x, z)` ground plane. Every
 * number is pulled from `../constants` (transcribed from the specs); every rule —
 * income, the 8×3 build grid, spawners and Solar Extractors, the wave clock, unit
 * movement and the diagonal corridor, target acquisition with its hold-and-buffer
 * rules, the full counter matrix (including the `—` cannot-target blocks, Air/Flak,
 * splash, Bombard's minimum range, Lumen's heal), combat resolution, the Reliquary
 * (regen + `+700` bounty) and its Aegis (three independent turrets, own-half only),
 * and the base-razed win/lose — lives here.
 *
 * The renderer and HUD read this state through {@link World}; they never mutate it.
 * A step is `world.step(dtSeconds)`; the same World drives both the live game and the
 * headless test harness (`test/sim.test.ts`), which is why nothing here imports a
 * framework.
 */

import type { Armor, AttackType, Team, UnitType } from "../types";
import {
  ACQUISITION_BUFFER,
  AEGIS,
  ARENA_SIZE,
  BASE_HP,
  BASE_PROXIMITY,
  COUNTER,
  ENEMY_BASE,
  ENEMY_RELIQUARY,
  FIRST_WAVE_DELAY_S,
  LUMEN_HEAL_AMOUNT,
  LUMEN_HEAL_INTERVAL_S,
  LUMEN_HEAL_RANGE,
  MAX_STRUCTURE_LEVEL,
  MIDLINE_SUM,
  PASSIVE_INCOME_PER_S,
  PLAYER_BASE,
  PLAYER_RELIQUARY,
  RELIQUARY_BOUNTY,
  RELIQUARY_HP,
  RELIQUARY_REGEN_HP_PER_S,
  SELL_REFUND_FRACTION,
  SOLAR_EXTRACTOR_COST,
  SOLAR_EXTRACTOR_INCOME_BY_LEVEL,
  SOLAR_EXTRACTOR_UPGRADE_COST,
  SPAWNER_LEVEL_BONUS,
  SPAWNER_UPGRADE_COST_FRACTION,
  START_SOL,
  STRUCTURE_ARMOR,
  UNIT_STATS,
  WAVE_INTERVAL_S,
} from "../constants";
import {
  advanceDir,
  clamp,
  clampToCorridor,
  distance,
  dist2,
  facingYaw,
  midlineSum,
  musterPositions,
  type Vec2,
} from "../mathutil";

// ---------------------------------------------------------------------------
// Simulation state (mutable). These are what the renderer/HUD read each frame.
// ---------------------------------------------------------------------------

/** How long a destroyed entity flashes white before it is removed (specs/units.md). */
const DEATH_FLASH_MS = 450;
/** Seconds a Reliquary must go undamaged before it resumes regenerating. */
const RELIQUARY_REGEN_DELAY_S = 1.0;
/** Aegis main-gun firing cone half-angle (radians); it turns its hull to aim. */
const AEGIS_MAIN_CONE = 0.32;
/** How fast the Aegis hull yaws toward its main target (radians/second). */
const AEGIS_HULL_TURN = 1.6;
/** The Air Sunhawk flies at this fixed render altitude; ground attacks can't reach it. */
const SUNHAWK_ALTITUDE = 55;

/** What kind of thing a combatant is (drives targeting rules and win/lose). */
export type CombatKind = "unit" | "aegis" | "base" | "reliquary";

/** The common shape every damageable thing shares (targeting reads only this). */
export interface Combatant {
  readonly id: number;
  readonly team: Team;
  readonly kind: CombatKind;
  x: number;
  z: number;
  /** Render-only height; only the Air Sunhawk is > 0. Ignored by planar distance. */
  altitude: number;
  readonly armor: Armor;
  hp: number;
  readonly maxHp: number;
  /** Set once hp hits 0; the entity flashes then is culled, and stops being a target. */
  dead: boolean;
  /** Milliseconds since death, for the white-flash-then-remove (specs/units.md). */
  deathMs: number;
}

/** One live combat unit on the field (a member of the ten-type roster). */
export interface SimUnit extends Combatant {
  readonly kind: "unit";
  readonly type: UnitType;
  /** The spawner level it was emitted at (1–3); scales its HP and damage. */
  readonly level: number;
  /** Facing yaw about +y (radians); the renderer orients the rig by this. */
  yaw: number;
  /** The held target's id (specs/units.md — no per-frame jitter), or null. */
  targetId: number | null;
  /** Seconds accumulated toward the next shot (cadence). */
  fireTimer: number;
  /** Seconds accumulated toward the next Lumen heal tick. */
  healTimer: number;
  /** Per-unit animation clock (ms) for the renderer's clip playback. */
  animMs: number;
  /** The active clip role this frame: `move` / `attack` / `idle`. */
  role: "move" | "attack" | "idle";
}

/** A pre-placed base — the objective. Does not fight; razing it ends the match. */
export interface SimBase extends Combatant {
  readonly kind: "base";
}

/** A pre-placed Reliquary — a tempo objective that self-repairs and summons an Aegis. */
export interface SimReliquary extends Combatant {
  readonly kind: "reliquary";
  /** Seconds since it last took damage; it only regenerates once this passes the delay. */
  sinceDamageS: number;
  /** Set once destruction (bounty + Aegis) has been paid out, so it fires once. */
  handled: boolean;
}

/** One of the Aegis's three independent turrets (specs/waves.md). */
export interface AegisTurret {
  readonly kind: "main" | "left" | "right";
  targetId: number | null;
  fireTimer: number;
  /** Caller yaw relative to the hull (radians), for the renderer's turret joint. */
  yaw: number;
  /** Caller pitch (radians), for the renderer's gun-elevation joint. */
  pitch: number;
  /** Whether it fired this step (for the muzzle-flash effect in a later phase). */
  firedThisStep: boolean;
}

/** The Aegis — the comeback guardian; own-half only, three independent turrets. */
export interface SimAegis extends Combatant {
  readonly kind: "aegis";
  yaw: number;
  animMs: number;
  /** True while any turret has a target in range (drives `bombardment` vs `march`). */
  firing: boolean;
  readonly main: AegisTurret;
  readonly left: AegisTurret;
  readonly right: AegisTurret;
}

/** A build-grid structure the player/AI places (a spawner or a Solar Extractor). */
export interface BuildStructure {
  readonly id: number;
  readonly team: Team;
  /** The unit type this spawner emits, or `solar-extractor` for an economy tile. */
  readonly kind: UnitType | "solar-extractor";
  readonly col: number;
  readonly row: number;
  level: number;
  /** Total sol sunk in (build + every upgrade); sell refunds 50% of this. */
  investedSol: number;
}

/** A shot fired this step, for muzzle flashes / sfx in a later phase. */
export interface ShotEvent {
  readonly attackerId: number;
  readonly turret?: "main" | "left" | "right";
}

/** The match outcome once a base falls. */
export type MatchResult = "player" | "enemy" | null;

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

/** The opposing team. */
export function other(team: Team): Team {
  return team === "player" ? "enemy" : "player";
}

/** The counter multiplier for an attack against an armor class, or null (`—`). */
export function counterMult(attack: AttackType, armor: Armor): number | null {
  return COUNTER[attack][armor];
}

/** The additive spawner-level bonus (L1 +0%, L2 +30%, L3 +60%) as a factor. */
export function levelBonus(level: number): number {
  return 1 + SPAWNER_LEVEL_BONUS[clamp(level, 1, MAX_STRUCTURE_LEVEL) - 1];
}

/** The sol cost to upgrade a build structure of `kind` (per level). */
export function upgradeCost(kind: UnitType | "solar-extractor"): number {
  if (kind === "solar-extractor") return SOLAR_EXTRACTOR_UPGRADE_COST;
  return Math.round(UNIT_STATS[kind].cost * SPAWNER_UPGRADE_COST_FRACTION);
}

/** The sol cost to build a structure of `kind`. */
export function buildCost(kind: UnitType | "solar-extractor"): number {
  return kind === "solar-extractor" ? SOLAR_EXTRACTOR_COST : UNIT_STATS[kind].cost;
}

// ---------------------------------------------------------------------------
// The World.
// ---------------------------------------------------------------------------

export class World {
  /** Live roster units, both teams (the GPU-instanced entities). */
  readonly units: SimUnit[] = [];
  /** Live Aegis guardians (0–2 over a match). */
  readonly aegis: SimAegis[] = [];
  /** The two bases, keyed by owning team. */
  readonly bases: Record<Team, SimBase>;
  /** The two Reliquaries, keyed by owning team. */
  readonly reliquaries: Record<Team, SimReliquary>;
  /** Build-grid structures (spawners + Solar Extractors), both teams. */
  readonly structures: BuildStructure[] = [];

  /** Current sol balance per team. */
  readonly sol: Record<Team, number> = { player: START_SOL, enemy: START_SOL };
  /** Whether a side has already been granted its one Aegis (specs/waves.md). */
  private readonly aegisGranted: Record<Team, boolean> = { player: false, enemy: false };

  /** The current wave number (0 before the first wave fires). */
  waveNumber = 0;
  /** Seconds until the next wave fires. */
  waveTimer = FIRST_WAVE_DELAY_S;
  /** Elapsed match time in seconds. */
  elapsedS = 0;
  /** The winner once a base is razed, else null (specs/flow.md). */
  result: MatchResult = null;

  /** Shots fired this step (drained by the effects layer each frame). */
  readonly shots: ShotEvent[] = [];

  private nextId = 1;

  constructor() {
    this.bases = {
      player: this.makeBase("player", PLAYER_BASE),
      enemy: this.makeBase("enemy", ENEMY_BASE),
    };
    this.reliquaries = {
      player: this.makeReliquary("player", PLAYER_RELIQUARY),
      enemy: this.makeReliquary("enemy", ENEMY_RELIQUARY),
    };
  }

  // --- Construction --------------------------------------------------------

  private makeBase(team: Team, at: Vec2): SimBase {
    return {
      id: this.nextId++, team, kind: "base", x: at.x, z: at.z, altitude: 0,
      armor: STRUCTURE_ARMOR, hp: BASE_HP, maxHp: BASE_HP, dead: false, deathMs: 0,
    };
  }

  private makeReliquary(team: Team, at: Vec2): SimReliquary {
    return {
      id: this.nextId++, team, kind: "reliquary", x: at.x, z: at.z, altitude: 0,
      armor: STRUCTURE_ARMOR, hp: RELIQUARY_HP, maxHp: RELIQUARY_HP, dead: false, deathMs: 0,
      sinceDamageS: RELIQUARY_REGEN_DELAY_S, handled: false,
    };
  }

  // --- Economy / building (specs/economy.md) -------------------------------

  /** The current income rate for a team: passive + every Solar Extractor bonus. */
  incomeRate(team: Team): number {
    let rate = PASSIVE_INCOME_PER_S;
    for (const s of this.structures) {
      if (s.team === team && s.kind === "solar-extractor") {
        rate += SOLAR_EXTRACTOR_INCOME_BY_LEVEL[s.level - 1];
      }
    }
    return rate;
  }

  /** Is a grid cell free for `team`? */
  cellFree(team: Team, col: number, row: number): boolean {
    return !this.structures.some((s) => s.team === team && s.col === col && s.row === row);
  }

  /** The structure occupying a cell, or null. */
  structureAt(team: Team, col: number, row: number): BuildStructure | null {
    return this.structures.find((s) => s.team === team && s.col === col && s.row === row) ?? null;
  }

  /**
   * Place a build structure on an empty, affordable cell (specs/economy.md). Returns
   * the new structure, or null if the cell is taken or the team cannot afford it.
   */
  place(team: Team, kind: UnitType | "solar-extractor", col: number, row: number): BuildStructure | null {
    if (this.result) return null;
    if (!this.cellFree(team, col, row)) return null;
    const cost = buildCost(kind);
    if (this.sol[team] < cost) return null;
    this.sol[team] -= cost;
    const s: BuildStructure = {
      id: this.nextId++, team, kind, col, row, level: 1, investedSol: cost,
    };
    this.structures.push(s);
    return s;
  }

  /** Upgrade a build structure one level (≤ 3) if affordable. Returns success. */
  upgrade(structure: BuildStructure): boolean {
    if (structure.level >= MAX_STRUCTURE_LEVEL) return false;
    const cost = upgradeCost(structure.kind);
    if (this.sol[structure.team] < cost) return false;
    this.sol[structure.team] -= cost;
    structure.level += 1;
    structure.investedSol += cost;
    return true;
  }

  /** Sell a build structure, refunding 50% of its total invested sol (rounded). */
  sell(structure: BuildStructure): number {
    const idx = this.structures.indexOf(structure);
    if (idx < 0) return 0;
    const refund = Math.round(structure.investedSol * SELL_REFUND_FRACTION);
    this.sol[structure.team] += refund;
    this.structures.splice(idx, 1);
    return refund;
  }

  // --- The wave clock (specs/waves.md) -------------------------------------

  /** Fire a wave now: every spawner on each side emits one unit at its muster line. */
  fireWave(): void {
    this.waveNumber += 1;
    for (const team of ["player", "enemy"] as const) this.emitWaveFor(team);
  }

  private emitWaveFor(team: Team): void {
    const spawners = this.structures.filter(
      (s) => s.team === team && s.kind !== "solar-extractor",
    );
    if (spawners.length === 0) return;
    const slots = musterPositions(team, spawners.length);
    const yaw = facingYaw(advanceDir(team));
    spawners.forEach((s, i) => {
      this.spawnUnit(team, s.kind as UnitType, s.level, slots[i], yaw);
    });
  }

  /** Emit one unit onto the field at a muster slot (specs/waves.md). */
  spawnUnit(team: Team, type: UnitType, level: number, at: Vec2, yaw: number): SimUnit {
    const stats = UNIT_STATS[type];
    const maxHp = stats.hp * levelBonus(level);
    const u: SimUnit = {
      id: this.nextId++, team, kind: "unit", type, level,
      x: at.x, z: at.z, altitude: type === "sunhawk" ? SUNHAWK_ALTITUDE : 0,
      armor: stats.armor, hp: maxHp, maxHp, dead: false, deathMs: 0,
      yaw, targetId: null, fireTimer: 0, healTimer: 0, animMs: 0, role: "move",
    };
    this.units.push(u);
    return u;
  }

  // --- The Reliquary's Aegis (specs/waves.md) ------------------------------

  /** Spawn the losing side's one Aegis at its base (guarded: ≤1/side, ≤2/match). */
  private grantAegis(team: Team): void {
    if (this.aegisGranted[team]) return;
    if (this.aegis.length >= AEGIS.maxPerMatch) return;
    this.aegisGranted[team] = true;
    const base = this.bases[team];
    const yaw = facingYaw(advanceDir(team));
    const t = (kind: AegisTurret["kind"]): AegisTurret => ({
      kind, targetId: null, fireTimer: 0, yaw: 0, pitch: 0, firedThisStep: false,
    });
    this.aegis.push({
      id: this.nextId++, team, kind: "aegis",
      x: base.x, z: base.z, altitude: 0,
      armor: AEGIS.armor, hp: AEGIS.hp, maxHp: AEGIS.hp, dead: false, deathMs: 0,
      yaw, animMs: 0, firing: false,
      main: t("main"), left: t("left"), right: t("right"),
    });
  }

  /** Count the Aegis currently active for a team (0 or 1). */
  aegisCountFor(team: Team): number {
    return this.aegis.filter((a) => a.team === team && !a.dead).length;
  }

  // --- Targeting queries ---------------------------------------------------

  /** Every live mobile enemy combatant (roster units + Aegis) of `team`'s foe. */
  private enemyMobiles(team: Team): Combatant[] {
    const foe = other(team);
    const out: Combatant[] = [];
    for (const u of this.units) if (u.team === foe && !u.dead) out.push(u);
    for (const a of this.aegis) if (a.team === foe && !a.dead) out.push(a);
    return out;
  }

  /** The enemy's live static structures (Reliquary, then base). */
  private enemyStructures(team: Team): Combatant[] {
    const foe = other(team);
    const out: Combatant[] = [];
    const rel = this.reliquaries[foe];
    if (!rel.dead && rel.hp > 0) out.push(rel);
    const base = this.bases[foe];
    if (!base.dead && base.hp > 0) out.push(base);
    return out;
  }

  /** Look up any combatant by id (units, Aegis, bases, Reliquaries). */
  private combatantById(id: number | null): Combatant | null {
    if (id == null) return null;
    for (const u of this.units) if (u.id === id) return u;
    for (const a of this.aegis) if (a.id === id) return a;
    for (const t of ["player", "enemy"] as const) {
      if (this.bases[t].id === id) return this.bases[t];
      if (this.reliquaries[t].id === id) return this.reliquaries[t];
    }
    return null;
  }

  // --- The step ------------------------------------------------------------

  /**
   * Advance the whole simulation by `dtSeconds` (frame-rate independent). Order:
   * income, the wave clock, Reliquary regen, unit AI + combat, Aegis AI + combat,
   * then destruction bookkeeping and the win/lose check.
   */
  step(dtSeconds: number): void {
    if (this.result) return;
    const dt = dtSeconds;
    this.elapsedS += dt;
    this.shots.length = 0;

    // Passive + Extractor income for both sides.
    for (const team of ["player", "enemy"] as const) {
      this.sol[team] += this.incomeRate(team) * dt;
    }

    // Wave clock.
    this.waveTimer -= dt;
    if (this.waveTimer <= 0) {
      this.fireWave();
      this.waveTimer += WAVE_INTERVAL_S;
    }

    // Reliquary regen when undamaged.
    for (const team of ["player", "enemy"] as const) {
      const rel = this.reliquaries[team];
      if (rel.dead) continue;
      rel.sinceDamageS += dt;
      // Regenerate only a still-standing, undamaged Reliquary — never revive one that
      // has hit 0 before its destruction (bounty + Aegis) resolves this step.
      if (rel.hp > 0 && rel.sinceDamageS >= RELIQUARY_REGEN_DELAY_S && rel.hp < rel.maxHp) {
        rel.hp = Math.min(rel.maxHp, rel.hp + RELIQUARY_REGEN_HP_PER_S * dt);
      }
    }

    // Roster unit AI + combat.
    for (const u of this.units) {
      if (u.dead) continue;
      this.stepUnit(u, dt);
    }
    // Aegis AI + combat.
    for (const a of this.aegis) {
      if (a.dead) continue;
      this.stepAegis(a, dt);
    }

    // Destruction: flag newly-dead, pay Reliquary bounty + Aegis, advance flashes,
    // and cull entities whose flash has elapsed.
    this.resolveDestruction(dt);

    // Win/lose: a base at 0 HP ends the match instantly (specs/flow.md).
    if (this.bases.enemy.hp <= 0) this.result = "player";
    else if (this.bases.player.hp <= 0) this.result = "enemy";
  }

  // --- Unit AI + combat ----------------------------------------------------

  private stepUnit(u: SimUnit, dt: number): void {
    u.animMs += dt * 1000;
    const stats = UNIT_STATS[u.type];

    // Lumen is pure support: it never targets an enemy; it marches with the army and
    // heals the most-wounded nearby ally on its own cadence (specs/units.md).
    if (stats.attack === "Support") {
      this.stepLumen(u, dt);
      return;
    }

    const acqRange = stats.range + ACQUISITION_BUFFER;

    // Hold the current target until it dies or leaves the acquisition range.
    let target = this.combatantById(u.targetId);
    if (target && (target.dead || !this.canDamage(u, target) || distance(u, target) > this.acquireRange(target, acqRange))) {
      target = null;
      u.targetId = null;
    }

    // Acquire a new target: nearest damageable enemy unit first, then a structure.
    if (!target) {
      target = this.acquireTarget(u, acqRange);
      u.targetId = target ? target.id : null;
    }

    if (target) {
      const d = distance(u, target);
      const range = this.rangeFor(u, target);
      this.faceToward(u, target);
      if (d <= range) {
        // In range: stop and fire on cadence (respecting Bombard's minimum range).
        u.role = "attack";
        u.fireTimer += dt;
        const canFire = d >= stats.minRange;
        if (canFire && u.fireTimer >= (stats.cadenceS ?? Infinity)) {
          u.fireTimer = 0;
          this.fire(u, target);
        }
      } else if (d <= range + ACQUISITION_BUFFER) {
        // Within the buffer but not in range: close the gap.
        u.role = "move";
        this.moveToward(u, target, stats.speedUps * dt);
      } else {
        u.role = "move";
        this.advance(u, stats.speedUps * dt);
      }
      return;
    }

    // No valid target: keep advancing down the lane toward the enemy base.
    u.role = "move";
    this.advance(u, stats.speedUps * dt);
  }

  private stepLumen(u: SimUnit, dt: number): void {
    u.healTimer += dt;
    let healed = false;
    if (u.healTimer >= LUMEN_HEAL_INTERVAL_S) {
      u.healTimer = 0;
      const patient = this.mostWoundedAllyNear(u, LUMEN_HEAL_RANGE);
      if (patient) {
        patient.hp = Math.min(patient.maxHp, patient.hp + LUMEN_HEAL_AMOUNT);
        healed = true;
      }
    }
    // Advance with the army; play the heal clip briefly on a heal.
    u.role = healed ? "attack" : "move";
    const stats = UNIT_STATS[u.type];
    // Face along the advance and keep pace with the front.
    this.advance(u, stats.speedUps * dt);
  }

  /** The most-wounded friendly roster unit within `range` (never a base/Reliquary). */
  private mostWoundedAllyNear(u: SimUnit, range: number): SimUnit | null {
    let best: SimUnit | null = null;
    let bestMissing = 0;
    const r2 = range * range;
    for (const a of this.units) {
      if (a === u || a.team !== u.team || a.dead) continue;
      if (a.hp >= a.maxHp) continue;
      if (dist2(u, a) > r2) continue;
      const missing = a.maxHp - a.hp;
      if (missing > bestMissing) {
        bestMissing = missing;
        best = a;
      }
    }
    return best;
  }

  /** Can this unit's attack damage the candidate at all (matrix `—` and Air rules)? */
  private canDamage(u: SimUnit, c: Combatant): boolean {
    return counterMult(UNIT_STATS[u.type].attack, c.armor) !== null;
  }

  /** The effective attack range against a target (base gets the proximity floor). */
  private rangeFor(u: SimUnit, c: Combatant): number {
    const range = UNIT_STATS[u.type].range;
    return c.kind === "base" ? Math.max(range, BASE_PROXIMITY) : range;
  }

  /** The acquisition-hold range for a held target (its effective range + buffer). */
  private acquireRange(c: Combatant, fallback: number): number {
    return c.kind === "base" ? Math.max(fallback, BASE_PROXIMITY + ACQUISITION_BUFFER) : fallback;
  }

  /**
   * Acquire the nearest damageable enemy within the acquisition range: mobile units
   * first (Flakhound preferring Air), and only if none are in reach, a structure.
   */
  private acquireTarget(u: SimUnit, acqRange: number): Combatant | null {
    const mobiles = this.enemyMobiles(u.team);

    // Flakhound hunts Air first: if any Air is in reach, restrict the search to Air.
    let pool = mobiles.filter((c) => this.canDamage(u, c));
    if (u.type === "flakhound") {
      const air = pool.filter((c) => c.armor === "Air" && distance(u, c) <= acqRange);
      if (air.length > 0) pool = air;
    }

    let best: Combatant | null = null;
    let bestD2 = Infinity;
    for (const c of pool) {
      const d2 = dist2(u, c);
      if (d2 > acqRange * acqRange) continue;
      if (d2 < bestD2) { bestD2 = d2; best = c; }
    }
    if (best) return best;

    // No enemy units in range: attack an enemy structure if one is reachable.
    for (const c of this.enemyStructures(u.team)) {
      if (!this.canDamage(u, c)) continue;
      const reach = this.rangeFor(u, c) + ACQUISITION_BUFFER;
      const d = distance(u, c);
      if (d <= reach && d * d < bestD2) { bestD2 = d * d; best = c; }
    }
    return best;
  }

  /** Resolve one attack from `u` onto `target` (with splash for area attackers). */
  private fire(u: SimUnit, target: Combatant): void {
    const stats = UNIT_STATS[u.type];
    const base = stats.damage * levelBonus(u.level);
    this.damage(target, base, stats.attack);
    if (stats.splashRadius > 0) {
      this.splash(u.team, target, u.id, base, stats.attack, stats.splashRadius);
    }
    this.shots.push({ attackerId: u.id });
  }

  /** Apply splash: the same base damage to every OTHER enemy within the radius. */
  private splash(team: Team, impact: Vec2, sourceId: number, base: number, attack: AttackType, radius: number): void {
    const r2 = radius * radius;
    const victims = [...this.enemyMobiles(team), ...this.enemyStructures(team)];
    for (const c of victims) {
      if (c.id === sourceId) continue;
      if (dist2(impact, c) > r2) continue;
      this.damage(c, base, attack);
    }
  }

  /** Deal counter-scaled damage to `c`; a `—` (cannot-target) matchup is a no-op. */
  private damage(c: Combatant, base: number, attack: AttackType): void {
    const mult = counterMult(attack, c.armor);
    if (mult === null) return; // cannot target this armor class at all
    c.hp -= base * mult;
    if (c.kind === "reliquary") (c as SimReliquary).sinceDamageS = 0;
  }

  // --- Movement (specs/playfield.md corridor) ------------------------------

  /** Advance a unit straight down the diagonal toward the enemy corner. */
  private advance(u: SimUnit, dist: number): void {
    const dir = advanceDir(u.team);
    u.x += dir.x * dist;
    u.z += dir.z * dist;
    u.yaw = facingYaw(dir);
    this.constrain(u);
  }

  /** Move a unit toward a point (chasing a target within the buffer). */
  private moveToward(u: SimUnit, to: Vec2, dist: number): void {
    const dx = to.x - u.x;
    const dz = to.z - u.z;
    const len = Math.hypot(dx, dz);
    if (len < 1e-4) return;
    u.x += (dx / len) * dist;
    u.z += (dz / len) * dist;
    u.yaw = facingYaw({ x: dx / len, z: dz / len });
    this.constrain(u);
  }

  /** Point a unit at a target without moving (it is in range and firing). */
  private faceToward(u: SimUnit, to: Vec2): void {
    const dx = to.x - u.x;
    const dz = to.z - u.z;
    if (Math.abs(dx) + Math.abs(dz) < 1e-4) return;
    u.yaw = facingYaw({ x: dx, z: dz });
  }

  /** Keep a unit inside the corridor and the arena bounds. */
  private constrain(u: SimUnit): void {
    const c = clampToCorridor(u);
    u.x = clamp(c.x, 0, ARENA_SIZE);
    u.z = clamp(c.z, 0, ARENA_SIZE);
  }

  // --- Aegis AI + combat (specs/waves.md) ----------------------------------

  private stepAegis(a: SimAegis, dt: number): void {
    a.animMs += dt * 1000;
    a.main.firedThisStep = false;
    a.left.firedThisStep = false;
    a.right.firedThisStep = false;

    // --- Main turret: nearest Heavy in range (else nearest ground); Piercing. It
    //     determines the hull facing — the fortress rotates to bring it into the cone.
    const mainTarget = this.aegisMainTarget(a);
    a.main.targetId = mainTarget ? mainTarget.id : null;
    let firing = false;
    if (mainTarget) {
      const desired = this.bearingTo(a, mainTarget);
      a.yaw = this.turnToward(a.yaw, desired, AEGIS_HULL_TURN * dt);
      const rel = wrapAngle(desired - a.yaw);
      a.main.yaw = clamp(rel, -0.6, 0.6);
      const d = distance(a, mainTarget);
      if (Math.abs(rel) <= AEGIS_MAIN_CONE && d <= AEGIS.main.range) {
        a.main.fireTimer += dt;
        if (a.main.fireTimer >= AEGIS.main.cadenceS) {
          a.main.fireTimer = 0;
          a.main.firedThisStep = true;
          this.damage(mainTarget, AEGIS.main.damage, AEGIS.main.attack);
          this.shots.push({ attackerId: a.id, turret: "main" });
        }
        firing = true;
      }
    }

    // --- Side turrets: each sweeps its own flank for the nearest Light-first enemy in
    //     range, opportunistically, independent of the hull facing.
    firing = this.stepSideTurret(a, a.left, dt, -1) || firing;
    firing = this.stepSideTurret(a, a.right, dt, +1) || firing;
    a.firing = firing;

    // --- Movement: defend own half only; hunt an enemy that crossed onto our side,
    //     else hold near the front of our half. Never cross the midline.
    const prey = this.nearestEnemyOnOwnHalf(a);
    if (prey) {
      this.aegisMoveToward(a, prey, AEGIS.speedUps * dt);
    } else {
      this.aegisHoldFront(a, AEGIS.speedUps * dt);
    }
  }

  /** The main turret's target: nearest Heavy in range, falling back to nearest ground. */
  private aegisMainTarget(a: SimAegis): Combatant | null {
    const mobiles = this.enemyMobiles(a.team).filter(
      (c) => c.armor !== "Air" && distance(a, c) <= AEGIS.main.range,
    );
    let heavy: Combatant | null = null;
    let heavyD = Infinity;
    let ground: Combatant | null = null;
    let groundD = Infinity;
    for (const c of mobiles) {
      const d = dist2(a, c);
      if (c.armor === "Heavy" && d < heavyD) { heavyD = d; heavy = c; }
      if (d < groundD) { groundD = d; ground = c; }
    }
    return heavy ?? ground;
  }

  /** Run one side turret; returns whether it fired/holds a target this step. */
  private stepSideTurret(a: SimAegis, turret: AegisTurret, dt: number, side: number): boolean {
    const target = this.aegisSideTarget(a, side);
    turret.targetId = target ? target.id : null;
    if (!target) return false;
    const rel = wrapAngle(this.bearingTo(a, target) - a.yaw);
    turret.yaw = clamp(rel, -1.0, 1.0);
    if (distance(a, target) <= AEGIS.side.range) {
      turret.fireTimer += dt;
      if (turret.fireTimer >= AEGIS.side.cadenceS) {
        turret.fireTimer = 0;
        turret.firedThisStep = true;
        this.damage(target, AEGIS.side.damage, AEGIS.side.attack);
        this.splash(a.team, target, a.id, AEGIS.side.damage, AEGIS.side.attack, AEGIS.side.splashRadius);
        this.shots.push({ attackerId: a.id, turret: turret.kind === "left" ? "left" : "right" });
      }
      return true;
    }
    return false;
  }

  /** A side turret's target: nearest Light-first enemy on that flank, within range. */
  private aegisSideTarget(a: SimAegis, side: number): Combatant | null {
    const mobiles = this.enemyMobiles(a.team).filter((c) => c.armor !== "Air");
    let light: Combatant | null = null;
    let lightD = Infinity;
    let any: Combatant | null = null;
    let anyD = Infinity;
    for (const c of mobiles) {
      if (distance(a, c) > AEGIS.side.range) continue;
      const rel = wrapAngle(this.bearingTo(a, c) - a.yaw);
      if (Math.sign(rel) !== side) continue; // only this turret's flank arc
      const d = dist2(a, c);
      if (c.armor === "Light" && d < lightD) { lightD = d; light = c; }
      if (d < anyD) { anyD = d; any = c; }
    }
    return light ?? any;
  }

  /** The nearest enemy standing on the Aegis's own half of the field. */
  private nearestEnemyOnOwnHalf(a: SimAegis): Combatant | null {
    let best: Combatant | null = null;
    let bestD = Infinity;
    for (const c of this.enemyMobiles(a.team)) {
      if (!this.onOwnHalf(a.team, c)) continue;
      const d = dist2(a, c);
      if (d < bestD) { bestD = d; best = c; }
    }
    return best;
  }

  /** Is a point on `team`'s own half (player: x+z<1200, enemy: x+z>1200)? */
  private onOwnHalf(team: Team, p: Vec2): boolean {
    return team === "player" ? midlineSum(p) < MIDLINE_SUM : midlineSum(p) > MIDLINE_SUM;
  }

  /** Move the Aegis toward a point, never crossing its own midline. */
  private aegisMoveToward(a: SimAegis, to: Vec2, dist: number): void {
    const dx = to.x - a.x;
    const dz = to.z - a.z;
    const len = Math.hypot(dx, dz);
    if (len > 1e-4) {
      a.x += (dx / len) * dist;
      a.z += (dz / len) * dist;
    }
    this.keepOnHalf(a);
  }

  /** With no enemy on our half, drift toward the front of our half and hold. */
  private aegisHoldFront(a: SimAegis, dist: number): void {
    // A hold point on the diagonal a little back from the midline, on our side.
    const margin = 120;
    const holdSum = a.team === "player" ? MIDLINE_SUM - margin : MIDLINE_SUM + margin;
    const holdX = holdSum / 2;
    const holdZ = holdSum / 2;
    const dx = holdX - a.x;
    const dz = holdZ - a.z;
    const len = Math.hypot(dx, dz);
    if (len > 2) {
      a.x += (dx / len) * Math.min(dist, len);
      a.z += (dz / len) * Math.min(dist, len);
    }
    this.keepOnHalf(a);
  }

  /** Clamp the Aegis so it never crosses the diagonal midline (specs/waves.md). */
  private keepOnHalf(a: SimAegis): void {
    const sum = a.x + a.z;
    const limit = MIDLINE_SUM - 1; // stay strictly on our side
    if (a.team === "player" && sum > limit) {
      const push = (sum - limit) / 2;
      a.x -= push; a.z -= push;
    } else if (a.team === "enemy" && sum < MIDLINE_SUM + 1) {
      const push = (MIDLINE_SUM + 1 - sum) / 2;
      a.x += push; a.z += push;
    }
    a.x = clamp(a.x, 0, ARENA_SIZE);
    a.z = clamp(a.z, 0, ARENA_SIZE);
  }

  /** The world-space bearing (yaw about +y) from `a` to a point. */
  private bearingTo(a: Vec2, to: Vec2): number {
    return facingYaw({ x: to.x - a.x, z: to.z - a.z });
  }

  /** Rotate `from` toward `to` by at most `maxStep` radians (shortest way). */
  private turnToward(from: number, to: number, maxStep: number): number {
    const delta = wrapAngle(to - from);
    if (Math.abs(delta) <= maxStep) return to;
    return from + Math.sign(delta) * maxStep;
  }

  // --- Destruction bookkeeping ---------------------------------------------

  private resolveDestruction(dt: number): void {
    // Reliquary destruction: pay the destroyer +700 and spawn the loser's Aegis.
    for (const team of ["player", "enemy"] as const) {
      const rel = this.reliquaries[team];
      if (!rel.dead && rel.hp <= 0 && !rel.handled) {
        rel.handled = true;
        rel.dead = true;
        rel.hp = 0;
        this.sol[other(team)] += RELIQUARY_BOUNTY;
        this.grantAegis(team);
      }
    }

    // Flag newly-dead mobile combatants and advance their white-flash timers.
    for (const u of this.units) {
      if (!u.dead && u.hp <= 0) { u.dead = true; u.deathMs = 0; }
      if (u.dead) u.deathMs += dt * 1000;
    }
    for (const a of this.aegis) {
      if (!a.dead && a.hp <= 0) { a.dead = true; a.deathMs = 0; }
      if (a.dead) a.deathMs += dt * 1000;
    }

    // Cull entities whose death flash has elapsed.
    this.cullDead(this.units);
    this.cullDead(this.aegis);
  }

  private cullDead<T extends Combatant>(list: T[]): void {
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i].dead && list[i].deathMs >= DEATH_FLASH_MS) list.splice(i, 1);
    }
  }
}

/** Wrap an angle to (−π, π]. */
function wrapAngle(a: number): number {
  let x = a;
  while (x > Math.PI) x -= 2 * Math.PI;
  while (x <= -Math.PI) x += 2 * Math.PI;
  return x;
}
