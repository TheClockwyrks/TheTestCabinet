// Valence — the simulation (specs/matter.md, specs/towers.md, specs/flow.md).
//
// A fixed-step model of matter flowing along the branching conduit and grid-placed
// towers firing automatically. Matter is HIT POINTS + DAMAGE TYPES + STACKABLE TRAITS
// (specs/matter.md): a unit's shells are its hit points; any of three damage types —
// energy, kinetic, nuclear — strips them, gated only by the unit's traits (BONDED: an
// outer bond pool any tower chips, best chewed by kinetic; HEAVY: immune to energy;
// INERT: needs a detector to be seen). Seven general-purpose towers each pick one of two
// branches at tier III. Rendering, audio, and particles read this state and drain its
// event queues; the simulation itself is DOM-free and is driven identically by the
// browser and the headless balance harness (sim/).

import {
  ALPHA_ELECTRONS,
  BETA_ELECTRONS,
  BUILD_PHASE_SECONDS,
  INERT_ATOM_BOUNTY_BONUS,
  INTEREST_CAP,
  INTEREST_RATE,
  MARK_TIME,
  MATTER,
  PROJECTILE_SPEED,
  SLOW_ON_HIT_TIME,
  TARGETING_ORDER,
  TOTAL_ROUNDS,
  TOWERS,
  UPGRADE_MULT,
  atomBounty,
  atomRadius,
  atomSpeed,
  clampElectrons,
  deriveStats,
  roundClearBonus,
  scaledAtoms,
  scaledBondHP,
  scaledHeavyShells,
  scaledShells,
  type Branch,
  type DamageType,
  type DecayEmission,
  type EffStats,
  type MatterType,
  type TargetingMode,
  type TowerKind,
  type Trait,
} from "./constants";
import { Board, DEFAULT_MAP, TOWER_FOOTPRINT, type GameMap, type Lane, type Pt } from "./board";
import type { CampaignMode } from "./mode";
import { buildWave, type Wave } from "./waves";
import type { AtomSpec, Cue, FxEvent, GameState, Phase, Projectile, Tower, Unit, Zone } from "./types";

export class Game {
  readonly mode: CampaignMode;
  map: GameMap; // the chosen map (specs/board.md); set by startOn() before a run
  board: Board; // the paths + free-placement rules of the current map
  state: GameState = "title";
  phase: Phase = "build";
  // Interactive (in-place) pause: freezes the simulation while play interaction stays
  // live, so you can place / upgrade / sell towers on a still board (specs/controls.md).
  // Distinct from the `paused` GameState, which is the Esc overlay MENU (also frozen).
  paused = false;

  energy = 0;
  integrity = 0;
  maxIntegrity = 0;
  score = 0;
  round = 0; // 0 before Round 1 (the opening build phase)
  speed = 1; // 1 / 2 / 3

  units: Unit[] = [];
  projectiles: Projectile[] = []; // shots in flight (specs/towers.md)
  zones: Zone[] = []; // lingering Reactor Fallout fields (specs/towers.md)
  towers: Tower[] = []; // freely-placed towers (specs/board.md)

  // Build / selection UI state.
  buildKind: TowerKind | null = null;
  selectedTowerId: number | null = null;
  hoverShop: TowerKind | null = null;
  pointerX = -1; // logical-space pointer, for the held-tower cursor / range preview
  pointerY = -1;

  buildTimer = 0; // seconds left in a between-round build phase (0 = untimed opening)
  buildTimed = false;
  private wave: Wave | null = null;
  private nextWave: Wave; // the coming round, for the preview
  private spawnCursor = 0;
  private waveClock = 0; // ms into the current round
  private spawned = 0;
  private nextId = 1;

  // Simple run tallies (surfaced to the balance harness).
  kills = 0;
  leakCount = 0;

  // Event queues drained by the presentation layer each frame.
  fxQueue: FxEvent[] = [];
  sndQueue: Cue[] = [];

  constructor(mode: CampaignMode, map: GameMap = DEFAULT_MAP) {
    this.mode = mode;
    this.map = map;
    this.board = new Board(map);
    this.nextWave = buildWave(1, mode, this.board.pathCount);
  }

  // Choose the map to defend, then start a fresh run on it (specs/board.md, flow.md).
  startOn(map: GameMap): void {
    this.map = map;
    this.board = new Board(map);
    this.start();
  }

  // ---- Lifecycle --------------------------------------------------------------
  start(): void {
    this.state = "playing";
    this.phase = "build";
    this.paused = false;
    this.energy = this.mode.startEnergy;
    this.integrity = this.mode.startIntegrity;
    this.maxIntegrity = this.mode.startIntegrity;
    this.score = 0;
    this.round = 0;
    this.speed = 1;
    this.units = [];
    this.projectiles = [];
    this.zones = [];
    this.towers = [];
    this.buildKind = null;
    this.selectedTowerId = null;
    this.hoverShop = null;
    this.wave = null;
    this.nextWave = buildWave(1, this.mode, this.board.pathCount);
    this.spawnCursor = 0;
    this.spawned = 0;
    this.waveClock = 0;
    this.kills = 0;
    this.leakCount = 0;
    this.buildTimed = false; // the opening build phase is untimed (specs/flow.md)
    this.buildTimer = 0;
  }

  // ---- Fixed simulation step --------------------------------------------------
  fixedStep(dt: number): void {
    if (this.state !== "playing" || this.paused) return;

    if (this.phase === "build") {
      if (this.buildTimed) {
        this.buildTimer -= dt;
        if (this.buildTimer <= 0) this.beginRound(0);
      }
      for (const t of this.towers) t.fireAnim += dt;
      return;
    }

    // Round phase.
    this.waveClock += dt * 1000;
    this.spawnDue();
    this.stepAuras(dt);
    this.stepZones(dt);
    this.stepTowers(dt);
    this.stepUnits(dt);
    this.stepProjectiles(dt); // move shots after units move, so homing stays accurate
    this.cullDead();
    this.checkRoundEnd();
    if (this.integrity <= 0) this.lose();
  }

  private spawnDue(): void {
    const w = this.wave;
    if (!w) return;
    while (this.spawnCursor < w.events.length && w.events[this.spawnCursor]!.atMs <= this.waveClock) {
      const e = w.events[this.spawnCursor]!;
      this.units.push(this.makeUnit(e.type, e.lane, e.electrons));
      this.spawned++;
      this.spawnCursor++;
    }
  }

  // ---- Unit construction ------------------------------------------------------
  // `electrons` sizes a regular atom (its 1..6 electron count = its hit points); it is
  // ignored by the bonded / isotope types, which read their stats from MATTER and scale
  // by the round (specs/matter.md).
  private makeUnit(type: MatterType, lane: Lane, electrons?: number): Unit {
    const def = MATTER[type];
    const r = this.round;
    const traits = [...def.traits] as Trait[];
    const u: Unit = {
      id: this.nextId++,
      type,
      traits,
      lane,
      s: 0,
      element: def.element,
      baseSpeed: def.speed,
      shells: 0,
      maxShells: 0,
      atoms: [],
      bondHP: 0,
      maxBondHP: 0,
      revealed: false,
      revealTimer: 0,
      excite: 0,
      markTimer: 0,
      markBonus: 0,
      slowFactor: 1,
      hitSlowTimer: 0,
      hitSlowFactor: 1,
      radius: def.radius,
      decayChain: [],
      fragmentsShed: 0,
      fragmentTarget: 0,
      animT: 0,
      hitFlash: 0,
      dead: false,
    };
    if (traits.includes("bonded")) {
      const n = scaledAtoms(def.atoms, r);
      const shells = scaledShells(def.shells, r);
      u.atoms = Array.from({ length: n }, () => ({ element: def.element, shells }) as AtomSpec);
      u.bondHP = scaledBondHP(def.bondHP, r) + (n - def.atoms); // longer chains, tougher bonds
      u.maxBondHP = u.bondHP;
    } else if (traits.includes("heavy")) {
      // An unstable isotope (heavy / shroud / boss): hit points scale with the round, and
      // it breaks down along its decay chain as it is worn down (specs/matter.md).
      const bossExtra = type === "macromass" && r >= 20;
      u.shells = scaledHeavyShells(def.shells, r);
      u.maxShells = u.shells;
      u.decayChain = bossExtra ? [...def.decay, "beta", "alpha", "beta"] : [...def.decay];
      u.fragmentTarget = u.decayChain.length;
    } else {
      // A regular atom (plain or inert), sized by its electron count = its hit points; its
      // element tint (green ↔ blue) tracks the electron count so the ranks read apart.
      const e = clampElectrons(electrons ?? def.shells);
      this.setAtom(u, e);
    }
    return u;
  }

  // Configure a unit as a regular atom of `electrons` electrons: its electrons are its
  // shells, its speed and radius follow the electron count, and (green vs blue) tint tracks
  // its size so the ranks read apart (specs/matter.md, specs/overview.md).
  private setAtom(u: Unit, electrons: number, element?: 0 | 1): void {
    const e = clampElectrons(electrons);
    u.shells = e;
    u.maxShells = e;
    u.element = element ?? (e >= 4 ? 1 : 0);
    u.baseSpeed = atomSpeed(e);
    u.radius = atomRadius(e);
  }

  private makeFreeAtom(lane: Lane, s: number, element: 0 | 1, electrons: number, inert: boolean): Unit {
    const u: Unit = {
      id: this.nextId++,
      type: inert ? "noble" : "atom",
      traits: inert ? ["inert"] : [],
      lane,
      s,
      element,
      baseSpeed: 0,
      shells: 0,
      maxShells: 0,
      atoms: [],
      bondHP: 0,
      maxBondHP: 0,
      revealed: false,
      revealTimer: 0,
      excite: 0,
      markTimer: 0,
      markBonus: 0,
      slowFactor: 1,
      hitSlowTimer: 0,
      hitSlowFactor: 1,
      radius: 10,
      decayChain: [],
      fragmentsShed: 0,
      fragmentTarget: 0,
      animT: 0,
      hitFlash: 0,
      dead: false,
    };
    this.setAtom(u, electrons, element);
    return u;
  }

  private hasTrait(u: Unit, t: Trait): boolean {
    return u.traits.includes(t);
  }

  // ---- Auras (Catalyst / Moderator) and detection, applied before movement ----
  private stepAuras(dt: number): void {
    for (const u of this.units) {
      u.excite = 0;
      u.slowFactor = 1;
      u.markTimer = Math.max(0, u.markTimer - dt);
      u.hitSlowTimer = Math.max(0, u.hitSlowTimer - dt);
      if (this.hasTrait(u, "inert")) {
        u.revealTimer = Math.max(0, u.revealTimer - dt);
        u.revealed = u.revealTimer > 0; // reveal lingers after leaving a field
      }
    }
    for (const t of this.towers) {
      const s = this.eff(t);
      if (t.kind === "catalyst") {
        for (const u of this.unitsInRange(t)) {
          if (this.hasTrait(u, "inert")) {
            if (!u.revealed) this.fxQueue.push({ kind: "reveal", x: this.board.sample(u.lane, u.s).x, y: this.board.sample(u.lane, u.s).y });
            u.revealed = true;
            u.revealTimer = s.revealLinger;
          }
          u.excite = Math.max(u.excite, s.auraExcite);
        }
      } else if (t.kind === "moderator") {
        for (const u of this.unitsInRange(t)) {
          if (u.type === "macromass") continue; // the boss is immune (specs/matter.md)
          const applied = this.hasTrait(u, "heavy") ? Math.max(s.auraSlowHeavy, s.auraSlow) : s.auraSlow;
          u.slowFactor = Math.min(u.slowFactor, applied);
          if (s.auraExcite > 0) u.excite = Math.max(u.excite, s.auraExcite); // Containment brittleness
        }
      }
    }
    // On-hit slow (Cleaver Impactor) folds in after the auras.
    for (const u of this.units) {
      if (u.hitSlowTimer > 0) u.slowFactor = Math.min(u.slowFactor, u.hitSlowFactor);
    }
  }

  private eff(t: Tower): EffStats {
    return deriveStats(t.kind, t.level, t.branch);
  }

  private stepZones(dt: number): void {
    for (const z of this.zones) {
      z.life -= dt;
      z.tickAcc += dt;
      const period = 0.4;
      let apply = 0;
      while (z.tickAcc >= period) {
        z.tickAcc -= period;
        apply += z.dps * period;
      }
      for (const u of this.units) {
        if (u.dead) continue;
        const p = this.board.sample(u.lane, u.s);
        if (Math.hypot(p.x - z.x, p.y - z.y) > z.radius) continue;
        if (this.hasTrait(u, "inert")) {
          u.revealed = true;
          u.revealTimer = Math.max(u.revealTimer, 0.3);
        }
        if (apply > 0) this.damageUnit(u, apply, "nuclear", p);
      }
    }
    this.zones = this.zones.filter((z) => z.life > 0);
  }

  private *unitsInRange(t: Tower): Generator<Unit> {
    const r2 = t.range * t.range;
    for (const u of this.units) {
      if (u.dead) continue;
      const p = this.board.sample(u.lane, u.s);
      const dx = p.x - t.x;
      const dy = p.y - t.y;
      if (dx * dx + dy * dy <= r2) yield u;
    }
  }

  // ---- Tower fire -------------------------------------------------------------
  private stepTowers(dt: number): void {
    for (const t of this.towers) {
      t.fireAnim += dt;
      if (t.kind === "catalyst" || t.kind === "moderator") continue; // auras don't fire or aim
      const s = this.eff(t);
      const targets = this.pickTargets(t, s, s.multiTarget);
      const primary = targets[0] ?? null;
      if (primary) {
        const p = this.board.sample(primary.lane, primary.s);
        t.aimAngle = Math.atan2(p.y - (t.y - 4), p.x - t.x);
      }
      t.cooldown -= dt;
      if (t.cooldown > 0 || !primary) continue;
      t.cooldown = 1 / t.fireRate;
      t.fireAnim = 0;
      for (const tgt of targets) this.launchProjectile(t, s, tgt);
    }
  }

  private pickTargets(t: Tower, s: EffStats, n: number): Unit[] {
    const valid: Unit[] = [];
    for (const u of this.unitsInRange(t)) {
      if (this.isValidTarget(s, u)) valid.push(u);
    }
    // Order by this tower's targeting priority (specs/towers.md). The winner is targets[0];
    // a multi-target volley (Emitter Spread) takes the top `n` in the same order. With
    // inert-priority on, valid inert units (ones the tower can currently see) sort ahead of
    // everything else first, then the targeting mode orders within each group.
    valid.sort((a, b) => {
      if (t.prioritizeInert) {
        const ai = this.hasTrait(a, "inert") ? 0 : 1;
        const bi = this.hasTrait(b, "inert") ? 0 : 1;
        if (ai !== bi) return ai - bi;
      }
      return this.targetOrder(t, a, b);
    });
    return valid.slice(0, Math.max(1, n));
  }

  // Compare two valid targets under a tower's targeting mode (lower sorts first = higher
  // priority). FIRST/LAST order by conduit progress; NEAREST/FARTHEST by straight-line
  // distance from the tower; STRONGEST/WEAKEST by remaining hit points. All but the
  // progress modes break ties toward the unit furthest along, so the choice is deterministic.
  private targetOrder(t: Tower, a: Unit, b: Unit): number {
    switch (t.targeting) {
      case "last":
        return a.s - b.s;
      case "nearest":
        return this.towerDist2(t, a) - this.towerDist2(t, b) || b.s - a.s;
      case "farthest":
        return this.towerDist2(t, b) - this.towerDist2(t, a) || b.s - a.s;
      case "strongest":
        return this.unitHP(b) - this.unitHP(a) || b.s - a.s;
      case "weakest":
        return this.unitHP(a) - this.unitHP(b) || b.s - a.s;
      case "first":
      default:
        return b.s - a.s;
    }
  }

  // Squared straight-line distance from a tower to a unit's current position on the path,
  // for NEAREST / FARTHEST targeting (squared is enough for ordering).
  private towerDist2(t: Tower, u: Unit): number {
    const p = this.board.sample(u.lane, u.s);
    const dx = p.x - t.x;
    const dy = p.y - t.y;
    return dx * dx + dy * dy;
  }

  // A unit's remaining hit points, for STRONGEST / WEAKEST targeting: a bonded cluster's
  // outstanding bond pool plus the atoms it has yet to shed; otherwise its remaining shells.
  private unitHP(u: Unit): number {
    if (this.hasTrait(u, "bonded")) {
      let hp = Math.max(0, u.bondHP);
      for (let i = u.fragmentsShed; i < u.atoms.length; i++) hp += u.atoms[i]!.shells;
      return hp;
    }
    return Math.max(0, u.shells);
  }

  // A tower can act on a unit only if it can SEE it (not inert, or revealed, or the tower
  // detects) AND its damage type can reach it (specs/towers.md).
  private isValidTarget(s: EffStats, u: Unit): boolean {
    if (u.dead) return false;
    if (this.hasTrait(u, "inert") && !u.revealed && !s.detection) return false;
    return this.canDamage(s, u);
  }

  private canDamage(s: { damageType: DamageType | null; hitsHeavy: boolean }, u: Unit): boolean {
    if (!this.hasTrait(u, "heavy")) return true; // bonds and shells take any damage type
    // Heavy: immune to energy unless the shot explicitly hits heavies (Beam Disruptor).
    return s.damageType !== "energy" || s.hitsHeavy;
  }

  private launchProjectile(t: Tower, s: EffStats, target: Unit): void {
    const muzzle = 14;
    const cx = t.x + Math.cos(t.aimAngle) * muzzle;
    const cy = t.y - 4 + Math.sin(t.aimAngle) * muzzle;
    this.projectiles.push({
      id: this.nextId++,
      kind: t.kind,
      damageType: s.damageType!,
      dmg: s.dmg,
      x: cx,
      y: cy,
      angle: t.aimAngle,
      speed: PROJECTILE_SPEED[t.kind],
      targetId: target.id,
      lane: target.lane,
      splash: s.splash,
      pierce: s.pierce,
      pierceRadius: 44,
      sameLane: false,
      chain: s.chain,
      bondBonus: s.bondBonus,
      heavyBonus: s.heavyBonus,
      hitsHeavy: s.hitsHeavy,
      splashOnHeavy: s.splashOnHeavy,
      slowOnHit: s.slowOnHit,
      mark: s.mark,
      hitIds: [],
      dead: false,
    });
    // Beam Lance pierces the whole lane; encode that on the freshly-pushed shot.
    const pr = this.projectiles[this.projectiles.length - 1]!;
    if (s.lanePierce) {
      pr.pierce = 99;
      pr.pierceRadius = 260;
      pr.sameLane = true;
    }
    this.sndQueue.push("shot");
    this.fxQueue.push({ kind: "muzzle", x: cx, y: cy });
  }

  // ---- Projectiles in flight --------------------------------------------------
  private stepProjectiles(dt: number): void {
    for (const pr of this.projectiles) {
      if (pr.dead) continue;
      const target = this.unitById(pr.targetId);
      if (!target || target.dead) {
        pr.dead = true; // the target is gone — the shot misses (specs/towers.md)
        continue;
      }
      const p = this.board.sample(target.lane, target.s);
      const dx = p.x - pr.x;
      const dy = p.y - pr.y;
      const dist = Math.hypot(dx, dy) || 1;
      const step = pr.speed * dt;
      pr.angle = Math.atan2(dy, dx);
      if (dist <= step + target.radius) {
        pr.x = p.x;
        pr.y = p.y;
        pr.dead = true;
        this.onImpact(pr, target);
      } else {
        pr.x += (dx / dist) * step;
        pr.y += (dy / dist) * step;
      }
    }
  }

  private onImpact(pr: Projectile, primary: Unit): void {
    const p = this.board.sample(primary.lane, primary.s);
    this.strike(pr, primary, p.x, p.y);

    // Area of effect (Reactor blast / Emitter Charged) — every unit in the radius.
    if (pr.splash > 0) {
      for (const u of this.units) {
        if (u.dead || pr.hitIds.includes(u.id)) continue;
        const q = this.board.sample(u.lane, u.s);
        if (Math.hypot(q.x - p.x, q.y - p.y) <= pr.splash) this.strike(pr, u, q.x, q.y);
      }
    }
    // Pierce — pass through further units (a line, or the whole lane for a Lance).
    if (pr.pierce > 0) {
      const extra: { u: Unit; d: number; x: number; y: number }[] = [];
      for (const u of this.units) {
        if (u.dead || pr.hitIds.includes(u.id)) continue;
        if (pr.sameLane && u.lane !== pr.lane) continue;
        const q = this.board.sample(u.lane, u.s);
        const d = Math.hypot(q.x - p.x, q.y - p.y);
        if (d <= pr.pierceRadius) extra.push({ u, d, x: q.x, y: q.y });
      }
      extra.sort((a, b) => a.d - b.d);
      for (const e of extra.slice(0, pr.pierce)) this.strike(pr, e.u, e.x, e.y);
    }
    // Chain — arc to a nearby atom (Ionizer Overcharge).
    if (pr.chain > 0) {
      let arcs = pr.chain;
      let fx = p.x;
      let fy = p.y;
      while (arcs > 0) {
        let best: { u: Unit; d: number; x: number; y: number } | null = null;
        for (const u of this.units) {
          if (u.dead || pr.hitIds.includes(u.id)) continue;
          if (this.hasTrait(u, "heavy") || this.hasTrait(u, "bonded")) continue;
          if (this.hasTrait(u, "inert") && !u.revealed) continue;
          const q = this.board.sample(u.lane, u.s);
          const d = Math.hypot(q.x - fx, q.y - fy);
          if (d <= 70 && (!best || d < best.d)) best = { u, d, x: q.x, y: q.y };
        }
        if (!best) break;
        this.strike(pr, best.u, best.x, best.y);
        fx = best.x;
        fy = best.y;
        arcs--;
      }
    }
  }

  // Apply one landed shot to one unit. Damage runs against the unit's traits: a bonded
  // unit's bond pool first (kinetic gets a bonus there), a heavy's shells (energy can't),
  // a free atom's shells (specs/matter.md).
  private strike(pr: Projectile, u: Unit, x: number, y: number): void {
    if (u.dead || pr.hitIds.includes(u.id)) return;
    if (!this.canDamage(pr, u)) return;
    pr.hitIds.push(u.id);
    u.hitFlash = 0;
    if (pr.mark > 0 && !this.hasTrait(u, "bonded")) {
      u.markTimer = MARK_TIME;
      u.markBonus = pr.mark;
    }
    if (pr.slowOnHit > 0) {
      u.hitSlowTimer = SLOW_ON_HIT_TIME;
      u.hitSlowFactor = pr.slowOnHit;
    }
    const bonus = u.excite + (u.markTimer > 0 ? u.markBonus : 0);
    if (this.hasTrait(u, "bonded")) {
      const raw = pr.dmg + bonus;
      const bd = pr.damageType === "kinetic" ? raw * pr.bondBonus : raw;
      this.bondDamage(u, bd, x, y);
      this.fxQueue.push({ kind: pr.damageType, x, y });
    } else {
      const raw = pr.dmg + bonus + (this.hasTrait(u, "heavy") ? pr.heavyBonus : 0);
      this.damageUnit(u, raw, pr.damageType, { x, y });
    }
    if (pr.splashOnHeavy > 0 && u.dead && this.hasTrait(u, "heavy")) {
      for (const o of this.units) {
        if (o === u || o.dead || !this.hasTrait(o, "heavy")) continue;
        const q = this.board.sample(o.lane, o.s);
        if (Math.hypot(q.x - x, q.y - y) <= pr.splashOnHeavy) this.damageUnit(o, pr.dmg, "kinetic", q);
      }
    }
  }

  // Bare shell damage (used by strike and by a Fallout zone's DoT). `dmgType` only picks
  // the burst colour here; trait gating is the caller's job.
  private damageUnit(u: Unit, amount: number, dmgType: DamageType, p: { x: number; y: number }): void {
    if (u.dead) return;
    if (this.hasTrait(u, "heavy") && dmgType === "energy") return; // guard (energy can't crack heavy)
    u.hitFlash = 0;
    u.shells -= amount;
    if (this.hasTrait(u, "heavy")) {
      // An unstable isotope breaks down along its decay chain as it is worn: each step it
      // crosses emits an alpha/beta particle and transmutes into a lighter isotope; spent,
      // it reaches a stable nucleus and is neutralized (specs/matter.md).
      this.decayProgress(u, p);
      if (u.shells <= 0) this.decayFinalize(u, p);
      else this.fxQueue.push({ kind: "nuclear", x: p.x, y: p.y });
      return;
    }
    if (u.shells <= 0) {
      this.neutralize(u, p);
    } else {
      u.baseSpeed = atomSpeed(u.shells); // shed an electron → the lighter atom is faster
      this.fxQueue.push({ kind: dmgType, x: p.x, y: p.y });
    }
  }

  // ---- Decomposition ----------------------------------------------------------
  private bondDamage(u: Unit, amount: number, x: number, y: number): void {
    u.bondHP -= amount;
    const k = u.atoms.length; // full constituent count (stable)
    const inert = this.hasTrait(u, "inert");
    const shellsAtom = scaledShells(2, this.round);
    if (k > 1) {
      const chunk = u.maxBondHP / (k - 1);
      const target = Math.min(k - 1, Math.floor((u.maxBondHP - Math.max(0, u.bondHP)) / chunk));
      while (u.fragmentsShed < target) {
        const a = u.atoms[u.fragmentsShed]!;
        this.units.push(this.makeFreeAtom(u.lane, u.s + 4, a.element, a.shells, inert));
        u.fragmentsShed++;
        this.fxQueue.push({ kind: "bondsnap", x, y });
        this.sndQueue.push("snap");
      }
    }
    if (u.bondHP <= 0) {
      // The cluster is fully opened — it becomes its last free atom.
      const last = u.atoms[k - 1] ?? { element: u.element, shells: shellsAtom };
      u.traits = u.traits.filter((t) => t !== "bonded");
      u.type = inert ? "noble" : "atom";
      this.setAtom(u, last.shells, last.element); // shells/speed/radius from its electrons
      u.atoms = [];
      u.bondHP = 0;
      this.fxQueue.push({ kind: "bondsnap", x, y });
      this.sndQueue.push("snap");
    }
  }

  private neutralize(u: Unit, p: { x: number; y: number }): void {
    u.dead = true;
    this.payBounty(u);
    this.fxQueue.push({ kind: "neutralize", x: p.x, y: p.y });
    this.sndQueue.push("neutralize");
  }

  private payBounty(u: Unit): void {
    const pay = this.bountyOf(u);
    this.energy += pay;
    this.score += pay;
    this.kills++;
  }

  // A regular atom pays by its electron count (a tougher atom pays more) plus an inert
  // detection premium; every other type pays its fixed bounty (specs/matter.md, flow.md).
  private bountyOf(u: Unit): number {
    if (u.type === "atom" || u.type === "noble") {
      return atomBounty(u.maxShells) + (this.hasTrait(u, "inert") ? INERT_ATOM_BOUNTY_BONUS : 0);
    }
    return MATTER[u.type].energy;
  }

  // An isotope fountains matter as it is worn down: each decay step it crosses emits its
  // particle — an alpha (a 6-electron atom) or a beta (a 2-electron atom) — onto the path
  // behind it while it transmutes into a lighter isotope (specs/matter.md).
  private decayProgress(u: Unit, p: { x: number; y: number }): void {
    if (u.fragmentTarget <= 0) return;
    const step = u.maxShells / (u.fragmentTarget + 1); // reserve the last band for finalize
    const want = Math.min(u.fragmentTarget, Math.floor((u.maxShells - Math.max(0, u.shells)) / step));
    while (u.fragmentsShed < want && u.shells > 0) {
      this.emitDecayParticle(u, u.fragmentsShed);
      u.fragmentsShed++;
      this.fxQueue.push({ kind: "split", x: p.x, y: p.y });
      this.sndQueue.push("nuclear");
    }
  }

  // The isotope has reached a stable nucleus: emit any decay steps not yet shed (a hard
  // hit can spend it in one blow), then neutralize it for its bounty (specs/matter.md).
  private decayFinalize(u: Unit, p: { x: number; y: number }): void {
    while (u.fragmentsShed < u.fragmentTarget) {
      this.emitDecayParticle(u, u.fragmentsShed);
      u.fragmentsShed++;
    }
    this.neutralize(u, p);
    this.fxQueue.push({ kind: "split", x: p.x, y: p.y });
    this.sndQueue.push("nuclear");
  }

  private emitDecayParticle(u: Unit, idx: number): void {
    const kind: DecayEmission = u.decayChain[idx] ?? "beta";
    const electrons = kind === "alpha" ? ALPHA_ELECTRONS : BETA_ELECTRONS;
    const element: 0 | 1 = kind === "alpha" ? 1 : 0; // alpha reads heavier (blue), beta lighter (green)
    const inert = this.hasTrait(u, "inert"); // a Shroud's emitted particles stay inert
    this.units.push(this.makeFreeAtom(u.lane, u.s - 8 - idx * 5, element, electrons, inert));
  }

  private unitById(id: number): Unit | null {
    for (const u of this.units) if (u.id === id) return u;
    return null;
  }

  // ---- Movement / leaks -------------------------------------------------------
  private stepUnits(dt: number): void {
    for (const u of this.units) {
      if (u.dead) continue;
      u.animT += dt;
      u.hitFlash += dt;
      const v = u.baseSpeed * u.slowFactor;
      u.s += v * dt;
      const len = this.board.pathLength(u.lane);
      if (u.s >= len) this.leak(u);
    }
  }

  private leak(u: Unit): void {
    u.dead = true;
    const cost = this.leakOf(u);
    this.integrity -= cost;
    this.leakCount += cost;
    const p = this.board.sample(u.lane, this.board.pathLength(u.lane));
    this.fxQueue.push({ kind: "leak", x: p.x, y: p.y });
    this.sndQueue.push("alarm");
  }

  // A regular atom that reaches the collector costs its REMAINING electrons (each layer
  // is one integrity), so partial damage still helps; other types cost their fixed leak
  // value (specs/matter.md, specs/flow.md).
  private leakOf(u: Unit): number {
    if (u.type === "atom" || u.type === "noble") return Math.max(1, Math.round(u.shells));
    return MATTER[u.type].leak;
  }

  private cullDead(): void {
    if (this.units.some((u) => u.dead)) this.units = this.units.filter((u) => !u.dead);
    if (this.projectiles.some((p) => p.dead)) this.projectiles = this.projectiles.filter((p) => !p.dead);
  }

  // ---- Round flow -------------------------------------------------------------
  private checkRoundEnd(): void {
    const w = this.wave;
    if (!w) return;
    const done = this.spawnCursor >= w.events.length && this.units.length === 0;
    if (done) this.endRound();
  }

  private endRound(): void {
    this.score += 100 * this.round;
    this.energy += roundClearBonus(this.round);
    this.wave = null;
    this.projectiles = [];
    this.zones = [];
    if (this.round >= TOTAL_ROUNDS) {
      this.win();
      return;
    }
    this.phase = "build";
    this.buildTimed = true;
    this.buildTimer = BUILD_PHASE_SECONDS;
    this.nextWave = buildWave(this.round + 1, this.mode, this.board.pathCount);
    if (this.mode.interest) {
      this.energy += Math.min(INTEREST_CAP, Math.floor(this.energy * INTEREST_RATE));
    }
    for (const t of this.towers) t.refundable = false;
  }

  private beginRound(earlySeconds: number): void {
    if (earlySeconds > 0) this.energy += earlySeconds;
    this.round += 1;
    this.phase = "round";
    this.paused = false; // launching a round always resumes the simulation
    this.wave = this.nextWave;
    this.spawnCursor = 0;
    this.spawned = 0;
    this.waveClock = 0;
    this.buildTimed = false;
    this.buildTimer = 0;
    this.nextWave = buildWave(Math.min(this.round + 1, TOTAL_ROUNDS), this.mode, this.board.pathCount);
    for (const t of this.towers) t.refundable = false;
  }

  // ---- Dev/proof helpers (also the balance-harness control surface) -----------
  devGrant(energy: number, integrity: number): void {
    this.energy = energy;
    this.integrity = integrity;
    this.maxIntegrity = Math.max(this.maxIntegrity, integrity);
  }
  devBeginRound(n: number): void {
    this.round = n - 1;
    this.nextWave = buildWave(n, this.mode, this.board.pathCount);
    this.phase = "build";
    this.buildTimed = false;
    this.startRound();
  }
  devFinishRound(): void {
    if (this.wave) this.spawnCursor = this.wave.events.length;
    this.units = [];
  }

  private win(): void {
    this.score += 250 * Math.max(0, this.integrity);
    this.state = "victory";
  }
  private lose(): void {
    this.integrity = 0;
    this.state = "defeat";
    this.units = [];
    this.projectiles = [];
    this.zones = [];
    this.wave = null;
  }

  // Toggle the interactive (in-place) pause. Only meaningful while playing; the board
  // stays interactive so towers can still be placed / upgraded (specs/controls.md).
  togglePause(): void {
    if (this.state === "playing") this.paused = !this.paused;
  }

  // ---- Player actions (called by input, routed via clickables) ----------------
  startRound(): void {
    if (this.state !== "playing" || this.phase !== "build") return;
    const early = this.buildTimed ? Math.max(0, Math.floor(this.buildTimer)) : 0;
    this.beginRound(early);
  }

  selectShop(kind: TowerKind): void {
    if (this.state !== "playing") return;
    this.buildKind = kind;
    this.selectedTowerId = null;
  }

  cancelBuild(): void {
    this.buildKind = null;
  }

  // The built tower whose footprint contains world point (x, y), if any.
  towerAt(x: number, y: number): Tower | null {
    for (const t of this.towers) {
      if (Math.hypot(t.x - x, t.y - y) <= TOWER_FOOTPRINT) return t;
    }
    return null;
  }

  // A click on the board (specs/controls.md): in build mode, place the held tower at the
  // pointer (refused if illegal); otherwise select a tower under the pointer, or deselect.
  clickBoard(x: number, y: number): void {
    if (this.state !== "playing") return;
    if (this.buildKind) {
      this.place(x, y, this.buildKind);
      return;
    }
    const hit = this.towerAt(x, y);
    this.selectedTowerId = hit ? hit.id : null;
  }

  clickEmptyBoard(): void {
    if (this.buildKind) this.buildKind = null;
    else this.selectedTowerId = null;
  }

  // Is (x, y) a legal, affordable spot for `kind`? Off the paths, in bounds, no overlap.
  canBuildAt(x: number, y: number, kind: TowerKind): boolean {
    return this.energy >= TOWERS[kind].cost && this.board.canPlaceAt(x, y, this.towers);
  }

  // Place a tower at a free board position (specs/board.md). Returns the built tower, or
  // null if the spot is illegal or unaffordable.
  place(x: number, y: number, kind: TowerKind): Tower | null {
    if (!this.canBuildAt(x, y, kind)) return null;
    const def = TOWERS[kind];
    const s = deriveStats(kind, 1, null);
    this.energy -= def.cost;
    const t: Tower = {
      id: this.nextId++,
      kind,
      level: 1,
      branch: null,
      targeting: "first", // towers default to FIRST; the player can retarget (specs/towers.md)
      prioritizeInert: false, // opt-in: prefer inert matter it can see (specs/towers.md)
      x,
      y,
      range: s.range,
      fireRate: s.fireRate,
      cooldown: 0,
      spent: def.cost,
      placedInBuildPhaseOf: this.round,
      refundable: this.phase === "build",
      fireAnim: 999,
      aimAngle: -Math.PI / 2,
    };
    this.towers.push(t);
    this.selectedTowerId = t.id;
    this.sndQueue.push("build");
    return t;
  }

  // Place near a target world point, snapping to the nearest legal spot (the balance
  // harness names approximate anchors; the browser places exactly at the pointer instead).
  placeNear(x: number, y: number, kind: TowerKind): Tower | null {
    if (this.energy < TOWERS[kind].cost) return null;
    const p: Pt | null = this.board.nearestLegal(x, y, this.towers);
    if (!p) return null;
    return this.place(p.x, p.y, kind);
  }

  upgradeCost(t: Tower): number | null {
    if (t.level >= 3) return null;
    return Math.round(TOWERS[t.kind].cost * UPGRADE_MULT[t.level + 1]!);
  }

  // Upgrade a tower one tier. Reaching tier III requires a branch choice (A or B); tier
  // II ignores `branch`. Shared by the UI (the inspector's two branch buttons) and the
  // harness.
  upgrade(t: Tower, branch?: Branch): boolean {
    if (t.level >= 3) return false;
    if (t.level === 2 && !branch) return false; // tier III needs a branch
    const cost = this.upgradeCost(t);
    if (cost == null || this.energy < cost) return false;
    this.energy -= cost;
    t.spent += cost;
    t.level = (t.level + 1) as 1 | 2 | 3;
    if (t.level === 3) t.branch = branch!;
    const s = deriveStats(t.kind, t.level, t.branch);
    t.range = s.range;
    t.fireRate = s.fireRate;
    this.sndQueue.push("build");
    return true;
  }

  upgradeSelected(branch?: Branch): void {
    const t = this.selectedTower;
    if (t) this.upgrade(t, branch);
  }

  sellRefund(t: Tower): number {
    return t.refundable ? t.spent : Math.floor(t.spent * 0.7);
  }

  sell(t: Tower): void {
    this.energy += this.sellRefund(t);
    this.towers = this.towers.filter((o) => o.id !== t.id);
    if (this.selectedTowerId === t.id) this.selectedTowerId = null;
    this.sndQueue.push("build");
  }

  sellSelected(): void {
    const t = this.selectedTower;
    if (t) this.sell(t);
  }

  // Set / cycle a damage tower's targeting priority (specs/towers.md, specs/controls.md).
  // Support auras have no single target, so their targeting is left untouched.
  setTargeting(t: Tower, mode: TargetingMode): void {
    if (TOWERS[t.kind].support) return;
    t.targeting = mode;
  }
  cycleTargeting(t: Tower): void {
    if (TOWERS[t.kind].support) return;
    const i = TARGETING_ORDER.indexOf(t.targeting);
    t.targeting = TARGETING_ORDER[(i + 1) % TARGETING_ORDER.length]!;
  }
  cycleTargetingSelected(): void {
    const t = this.selectedTower;
    if (t) this.cycleTargeting(t);
  }

  // Toggle whether a damage tower prioritizes inert matter it can see (specs/towers.md) —
  // the analogue of a camo-priority toggle. Auras have no single target, so it's a no-op.
  toggleInertPriority(t: Tower): void {
    if (TOWERS[t.kind].support) return;
    t.prioritizeInert = !t.prioritizeInert;
  }
  toggleInertPrioritySelected(): void {
    const t = this.selectedTower;
    if (t) this.toggleInertPriority(t);
  }

  cycleSpeed(): void {
    this.speed = this.speed >= 3 ? 1 : this.speed + 1;
  }

  // ---- Derived reads for the HUD ---------------------------------------------
  get selectedTower(): Tower | null {
    return this.selectedTowerId != null ? (this.towers.find((t) => t.id === this.selectedTowerId) ?? null) : null;
  }
  get comingRound(): Wave {
    return this.nextWave;
  }
  statsOf(t: Tower): EffStats {
    return this.eff(t);
  }
  roundProgress(): number {
    const w = this.wave;
    if (!w || w.events.length === 0) return 0;
    return Math.min(1, this.spawnCursor / w.events.length);
  }
}
