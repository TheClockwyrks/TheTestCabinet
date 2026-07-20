// Valence — the simulation (specs/matter.md, specs/towers.md, specs/campaign.md).
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
  atomRadius,
  atomSpeed,
  clampElectrons,
  deriveStats,
  roundClearBonus,
  type Branch,
  type DamageType,
  type DecayEmission,
  type EffStats,
  type MatterType,
  type TargetingMode,
  type TowerKind,
  type Trait,
} from "./constants";
import { Board, DEFAULT_MAP, MAPS, TOWER_FOOTPRINT, type GameMap, type Lane, type Pt } from "./board";
import type { CampaignMode } from "./mode";
import { buildWave, type Wave } from "./waves";
import type { AtomSpec, Cue, EffectKind, EffectRec, FxEvent, GameState, Phase, Projectile, Tower, Unit, Zone } from "./types";

// How long a snapshot-visible burst lingers in `effects` (specs/instrumentation.md) — long
// enough that a driven scenario can step onto the hit and read the burst back.
const FX_EFFECT_LIFE = 0.4;
// Which presentation bursts surface in the snapshot's `effects`, and under which name. A
// shell strip (any damage-type burst) reads as "strip"; a leak burst is not a decomposition
// event, so it is presentation-only.
const FX_TO_EFFECT: Record<FxEvent["kind"], EffectKind | null> = {
  energy: "strip",
  kinetic: "strip",
  nuclear: "strip",
  bondsnap: "bondsnap",
  split: "split",
  neutralize: "neutralize",
  reveal: "reveal",
  muzzle: "muzzle",
  leak: null,
};

// Map the internal map topology labels to the snapshot's lowercase enum.
const MAP_TOPOLOGY: Record<string, "single" | "branching" | "multiple"> = {
  "SINGLE PATH": "single",
  BRANCHING: "branching",
  "MULTIPLE PATHS": "multiple",
};

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

  // The manual clock (specs/instrumentation.md). During normal play `autoStep` is true and
  // the animation-frame loop advances the simulation from the wall clock; the debug API sets
  // it false to take the clock, so `step(dt)` becomes the sole way the sim advances and a
  // scripted scenario is exact regardless of machine load.
  autoStep = true;
  simTime = 0; // accumulated simulation time, in seconds
  muted = false; // mirror of the audio mute flag, kept in sync by the loop (for snapshot)

  // Decomposition / muzzle bursts currently playing, for the debug snapshot (a short-lived
  // mirror of the presentation bursts, aged out each tick — see emitFx / fixedStep).
  effects: EffectRec[] = [];

  constructor(mode: CampaignMode, map: GameMap = DEFAULT_MAP) {
    this.mode = mode;
    this.map = map;
    this.board = new Board(map);
    this.nextWave = this.makeWave(1);
  }

  // Build the wave for round `n` from the fixed round table (specs/matter.md).
  private makeWave(n: number): Wave {
    return buildWave(n, this.mode, this.board.pathCount);
  }

  // Choose the map to defend, then start a fresh run on it (specs/board.md, campaign.md).
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
    this.nextWave = this.makeWave(1);
    this.spawnCursor = 0;
    this.spawned = 0;
    this.waveClock = 0;
    this.kills = 0;
    this.leakCount = 0;
    this.buildTimed = false; // the opening build phase is untimed (specs/campaign.md)
    this.buildTimer = 0;
  }

  // ---- Fixed simulation step --------------------------------------------------
  // Advances the simulation by one fixed step of `dt` seconds. Frozen on a menu screen and
  // while paused (the same freeze normal play and the manual clock both honour). The wave
  // spawner and the build-phase countdown are phase-gated; the entity systems (auras, zones,
  // towers, matter, projectiles) run in either phase, so a unit posed via the debug API
  // during the build phase still flows through the real sim (specs/instrumentation.md) — in
  // normal build phases there is no matter, so this is a no-op there.
  fixedStep(dt: number): void {
    if (this.state !== "playing" || this.paused) return;

    this.simTime += dt;
    this.ageEffects(dt);

    if (this.phase === "build") {
      if (this.buildTimed) {
        this.buildTimer -= dt;
        if (this.buildTimer <= 0) {
          this.beginRound(0);
          return;
        }
      }
    } else {
      this.waveClock += dt * 1000;
      this.spawnDue();
    }

    this.stepAuras(dt);
    this.stepZones(dt);
    this.stepTowers(dt);
    this.stepUnits(dt);
    this.stepProjectiles(dt); // move shots after units move, so homing stays accurate
    this.cullDead();
    if (this.phase === "round") this.checkRoundEnd();
    if (this.integrity <= 0) this.lose();
  }

  // Record a burst both for the presentation layer (fxQueue, drained each frame) and, for the
  // snapshot-visible ones, into the short-lived `effects` mirror the debug API reports.
  private emitFx(kind: FxEvent["kind"], x: number, y: number): void {
    this.fxQueue.push({ kind, x, y });
    const mapped = FX_TO_EFFECT[kind];
    if (mapped) this.effects.push({ id: this.nextId++, kind: mapped, x, y, life: FX_EFFECT_LIFE });
  }

  private ageEffects(dt: number): void {
    if (this.effects.length === 0) return;
    for (const e of this.effects) e.life -= dt;
    if (this.effects.some((e) => e.life <= 0)) this.effects = this.effects.filter((e) => e.life > 0);
  }

  private spawnDue(): void {
    const w = this.wave;
    if (!w) return;
    while (this.spawnCursor < w.events.length && w.events[this.spawnCursor]!.atMs <= this.waveClock) {
      const e = w.events[this.spawnCursor]!;
      this.units.push(this.makeUnit(e.type, e.lane, e.electrons, e.inert));
      this.spawned++;
      this.spawnCursor++;
    }
  }

  // ---- Unit construction ------------------------------------------------------
  // `electrons` sizes a regular atom (its 1..6 electron count = its hit points); it is
  // ignored by the bonded / isotope types, which read their stats from MATTER. `inert`
  // shields a unit of any type, the way a round table entry can call for shielded matter
  // (specs/matter.md); a type that is already inert is unaffected.
  private makeUnit(type: MatterType, lane: Lane, electrons?: number, inert = false): Unit {
    const def = MATTER[type];
    const traits = [...def.traits] as Trait[];
    if (inert && !traits.includes("inert")) traits.push("inert");
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
      const shells = def.atomShells || def.shells;
      u.atoms = Array.from({ length: def.atoms }, () => ({ element: def.element, shells }) as AtomSpec);
      u.bondHP = def.bondHP;
      u.maxBondHP = u.bondHP;
    }
    if (traits.includes("heavy")) {
      // An unstable isotope (heavy / shroud / boss): hit points scale with the round, and
      // it breaks down along its decay chain as it is worn down (specs/matter.md).
      u.shells = def.shells;
      u.maxShells = u.shells;
      u.decayChain = [...def.decay];
      u.fragmentTarget = u.decayChain.length;
    }
    if (!traits.includes("bonded") && !traits.includes("heavy")) {
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
            if (!u.revealed) this.emitFx("reveal", this.board.sample(u.lane, u.s).x, this.board.sample(u.lane, u.s).y);
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
      t.targetId = primary ? primary.id : null;
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
    this.emitFx("muzzle", cx, cy);
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
      this.emitFx(pr.damageType, x, y);
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
    u.hitFlash = 0;
    // Energy is paid for shells actually stripped, so overkill past the last shell pays
    // nothing (specs/campaign.md).
    this.earn(Math.min(amount, Math.max(0, u.shells)));
    u.shells -= amount;
    if (this.hasTrait(u, "heavy")) {
      // An unstable isotope breaks down along its decay chain as it is worn: each step it
      // crosses emits an alpha/beta particle and transmutes into a lighter isotope; spent,
      // it reaches a stable nucleus and is neutralized (specs/matter.md).
      this.decayProgress(u, p);
      if (u.shells <= 0) this.decayFinalize(u, p);
      else this.emitFx("nuclear", p.x, p.y);
      return;
    }
    if (u.shells <= 0) {
      this.neutralize(u, p);
    } else {
      u.baseSpeed = atomSpeed(u.shells); // shed an electron → the lighter atom is faster
      this.emitFx(dmgType, p.x, p.y);
    }
  }

  // ---- Decomposition ----------------------------------------------------------
  private bondDamage(u: Unit, amount: number, x: number, y: number): void {
    const bondBefore = u.bondHP;
    u.bondHP -= amount;
    const k = u.atoms.length; // full constituent count (stable)
    const inert = this.hasTrait(u, "inert");
    if (k > 1) {
      const chunk = u.maxBondHP / (k - 1);
      const target = Math.min(k - 1, Math.floor((u.maxBondHP - Math.max(0, u.bondHP)) / chunk));
      while (u.fragmentsShed < target) {
        const a = u.atoms[u.fragmentsShed]!;
        this.units.push(this.makeFreeAtom(u.lane, u.s + 4, a.element, a.shells, inert));
        u.fragmentsShed++;
        this.emitFx("bondsnap", x, y);
        this.sndQueue.push("snap");
      }
    }
    if (u.bondHP <= 0) {
      // Chipping a bond pool pays nothing while it drains; breaking it through pays the
      // whole pool at once, and overkill past the last point pays nothing on top
      // (specs/campaign.md).
      if (bondBefore > 0) this.earn(u.maxBondHP);
      if (this.hasTrait(u, "heavy")) {
        // A super-heavy nucleus behind a containment pool: breaking the pool exposes the
        // nucleus, which carries on as the isotope it already is (specs/matter.md).
        u.traits = u.traits.filter((t) => t !== "bonded");
        u.bondHP = 0;
        u.atoms = [];
        this.emitFx("bondsnap", x, y);
        this.sndQueue.push("snap");
        return;
      }
      // The cluster is fully opened — it becomes its last free atom.
      const last = u.atoms[k - 1] ?? { element: u.element, shells: MATTER[u.type].atomShells || 1 };
      u.traits = u.traits.filter((t) => t !== "bonded");
      u.type = inert ? "noble" : "atom";
      this.setAtom(u, last.shells, last.element); // shells/speed/radius from its electrons
      u.atoms = [];
      u.bondHP = 0;
      this.emitFx("bondsnap", x, y);
      this.sndQueue.push("snap");
    }
  }

  private neutralize(u: Unit, p: { x: number; y: number }): void {
    u.dead = true;
    this.kills++;
    this.emitFx("neutralize", p.x, p.y);
    this.sndQueue.push("neutralize");
  }

  // Energy is earned by damage dealt, not by kills (specs/campaign.md): each shell stripped
  // pays `1`, and a bond pool pays its whole value the moment it is broken through.
  private earn(amount: number): void {
    if (amount <= 0) return;
    this.energy += amount;
    this.score += amount;
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
      this.emitFx("split", p.x, p.y);
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
    this.emitFx("split", p.x, p.y);
    this.sndQueue.push("nuclear");
  }

  private emitDecayParticle(u: Unit, idx: number): void {
    const kind: DecayEmission = u.decayChain[idx] ?? "beta";
    const inert = this.hasTrait(u, "inert"); // a shielded parent's emissions stay shielded
    const s = u.s - 8 - idx * 5;
    if (kind === "daughter") {
      // A super-heavy nucleus sheds a DAUGHTER isotope: itself heavy, still radioactive,
      // and cracked in its own right (specs/matter.md).
      const d = this.makeUnit(inert ? "shroud" : "heavy", u.lane);
      d.s = s;
      this.units.push(d);
      return;
    }
    const electrons = kind === "alpha" ? ALPHA_ELECTRONS : BETA_ELECTRONS;
    const element: 0 | 1 = kind === "alpha" ? 1 : 0; // alpha reads heavier (blue), beta lighter (green)
    this.units.push(this.makeFreeAtom(u.lane, s, element, electrons, inert));
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
    this.emitFx("leak", p.x, p.y);
    this.sndQueue.push("alarm");
  }

  // A regular atom that reaches the collector costs its REMAINING electrons (each layer
  // is one integrity), so partial damage still helps; other types cost their fixed leak
  // value (specs/matter.md, specs/campaign.md).
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
    this.nextWave = this.makeWave(this.round + 1);
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
    this.nextWave = this.makeWave(Math.min(this.round + 1, TOTAL_ROUNDS));
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
    this.nextWave = this.makeWave(n);
    this.phase = "build";
    this.buildTimed = false;
    this.startRound();
  }
  devFinishRound(): void {
    if (this.wave) this.spawnCursor = this.wave.events.length;
    this.units = [];
  }

  // ---- Debug / automation surface (specs/instrumentation.md; installed on window.__valence) --
  //
  // Each control op routes through the same systems normal play uses — it arranges the world,
  // it never fabricates the outcome a scenario is meant to produce. Inert until called; the
  // debug API (src/debug.ts) is the only caller.

  // Return the game to its initial title state and re-arm manual stepping
  // (autoStep = false — a driver-clocked session). A seed may be supplied and is accepted
  // for API compatibility; this simulation draws no random numbers, so a scenario already
  // replays identically without one (specs/instrumentation.md).
  debugReset(_seed?: number): void {
    this.map = DEFAULT_MAP;
    this.board = new Board(this.map);
    this.state = "title";
    this.phase = "build";
    this.paused = false;
    this.energy = 0;
    this.integrity = 0;
    this.maxIntegrity = 0;
    this.score = 0;
    this.round = 0;
    this.speed = 1;
    this.units = [];
    this.projectiles = [];
    this.zones = [];
    this.towers = [];
    this.effects = [];
    this.buildKind = null;
    this.selectedTowerId = null;
    this.hoverShop = null;
    this.wave = null;
    this.nextWave = this.makeWave(1);
    this.spawnCursor = 0;
    this.spawned = 0;
    this.waveClock = 0;
    this.kills = 0;
    this.leakCount = 0;
    this.buildTimed = false;
    this.buildTimer = 0;
    this.simTime = 0;
    this.nextId = 1;
    this.fxQueue.length = 0;
    this.sndQueue.length = 0;
    this.autoStep = false;
  }

  private towerById(id: number): Tower | null {
    return this.towers.find((t) => t.id === id) ?? null;
  }

  // Set the round the next startRound() will build (a precondition — does not spawn anything).
  debugSetRound(n: number): void {
    this.round = Math.max(0, Math.round(n) - 1);
    this.phase = "build";
    this.buildTimed = false;
    this.buildTimer = 0;
    this.nextWave = this.makeWave(Math.max(1, Math.round(n)));
  }

  // Put one real unit onto a path through the real construction path, so it flows, is
  // targeted, decomposes, leaks, and pays out like any spawned unit. Returns its id.
  debugSpawnUnit(spec: { type?: string; electrons?: number; pathId?: number; progress?: number }): number {
    const raw = spec.type ?? "atom";
    const type = (raw === "isotope" ? "heavy" : raw) as MatterType;
    const lanes = this.board.pathCount;
    const lane = Math.max(0, Math.min(lanes - 1, Math.round(spec.pathId ?? 0)));
    const u = this.makeUnit(type, lane, spec.electrons);
    u.s = Math.max(0, Math.min(this.board.pathLength(lane), spec.progress ?? 0));
    this.units.push(u);
    return u.id;
  }

  // Build a tower through the real placement path, reporting the exact refusal reason.
  debugPlaceTower(kind: TowerKind, x: number, y: number): { ok: boolean; id: number | null; reason: "path" | "overlap" | "bounds" | "cost" | null } {
    if (this.energy < TOWERS[kind].cost) return { ok: false, id: null, reason: "cost" };
    const reason = this.board.placementReason(x, y, this.towers);
    if (reason) return { ok: false, id: null, reason };
    const t = this.place(x, y, kind);
    if (!t) return { ok: false, id: null, reason: "cost" };
    return { ok: true, id: t.id, reason: null };
  }

  debugUpgradeTower(id: number, branch?: Branch): boolean {
    const t = this.towerById(id);
    return t ? this.upgrade(t, branch) : false;
  }

  debugSellTower(id: number): number {
    const t = this.towerById(id);
    if (!t) return 0;
    const refund = this.sellRefund(t);
    this.sell(t);
    return refund;
  }

  debugSelectTower(id: number | null): void {
    this.selectedTowerId = id != null && this.towerById(id) ? id : null;
  }

  debugSetTargeting(id: number, priority: TargetingMode): void {
    const t = this.towerById(id);
    if (t) this.setTargeting(t, priority);
  }

  // Set (not toggle) a damage tower's inert-priority; auras have no single target, so no-op.
  debugSetInertPriority(id: number, on: boolean): void {
    const t = this.towerById(id);
    if (t && !TOWERS[t.kind].support) t.prioritizeInert = Boolean(on);
  }

  debugSetSpeed(multiplier: number): void {
    this.speed = Math.max(1, Math.min(3, Math.round(multiplier)));
  }

  debugSetEnergy(amount: number): void {
    this.energy = Math.max(0, amount);
  }

  debugSetIntegrity(amount: number): void {
    this.integrity = amount;
    this.maxIntegrity = Math.max(this.maxIntegrity, amount);
  }

  // A pure, JSON-serializable read of the full observable state (specs/instrumentation.md),
  // shared by the debug API's snapshot() and the debug overlay. Never mutates anything.
  debugSnapshot(): ValenceSnapshot {
    const inRun = this.state === "playing" || this.state === "paused" || this.state === "victory" || this.state === "defeat";
    const paths = inRun
      ? this.board.paths.map((p, i) => ({ id: i, length: p.length, points: p.poly.map((q) => ({ x: q.x, y: q.y })) }))
      : [];
    return {
      version: 1,
      screen: this.state,
      paused: this.paused,
      phase: this.phase,
      maps: MAPS.map((m) => ({
        id: m.id,
        name: m.name,
        difficulty: m.difficulty.toLowerCase() as "easy" | "medium" | "hard",
        topology: MAP_TOPOLOGY[m.topology] ?? "single",
        style: m.styleLabel.toLowerCase() as "curved" | "straight",
      })),
      map: inRun ? this.map.id : null,
      speed: this.speed,
      muted: this.muted,
      energy: this.energy,
      integrity: this.integrity,
      score: this.score,
      round: this.round,
      totalRounds: TOTAL_ROUNDS,
      buildCountdown: this.phase === "build" && this.buildTimed ? Math.max(0, this.buildTimer) : null,
      result: this.state === "victory" ? "victory" : this.state === "defeat" ? "defeat" : null,
      paths,
      matter: this.units.map((u) => {
        const p = this.board.sample(u.lane, u.s);
        const isAtom = u.type === "atom" || u.type === "noble";
        return {
          id: u.id,
          type: (u.type === "heavy" ? "isotope" : u.type) as MatterSnapType,
          x: p.x,
          y: p.y,
          pathId: u.lane,
          progress: u.s,
          speed: u.baseSpeed * u.slowFactor,
          baseSpeed: u.baseSpeed,
          hp: Math.max(0, u.shells),
          maxHp: u.maxShells,
          electrons: isAtom ? Math.max(0, u.shells) : null,
          bond: this.hasTrait(u, "bonded") ? Math.max(0, u.bondHP) : null,
          maxBond: this.hasTrait(u, "bonded") ? u.maxBondHP : null,
          traits: { bonded: this.hasTrait(u, "bonded"), heavy: this.hasTrait(u, "heavy"), inert: this.hasTrait(u, "inert") },
          revealed: u.revealed,
          slow: u.slowFactor,
          damageBonus: u.excite + (u.markTimer > 0 ? u.markBonus : 0),
        };
      }),
      towers: this.towers.map((t) => {
        const s = this.eff(t);
        const support = TOWERS[t.kind].support;
        return {
          id: t.id,
          type: t.kind,
          x: t.x,
          y: t.y,
          tier: t.level,
          branch: t.branch,
          damageType: s.damageType,
          range: t.range,
          damage: s.dmg,
          fireRate: t.fireRate,
          targeting: support ? null : t.targeting,
          inertPriority: t.prioritizeInert,
          angle: support ? null : t.aimAngle,
          targetId: t.targetId,
          cooldown: Math.max(0, t.cooldown),
          spent: t.spent,
        };
      }),
      projectiles: this.projectiles.map((pr) => ({
        id: pr.id,
        x: pr.x,
        y: pr.y,
        vx: Math.cos(pr.angle) * pr.speed,
        vy: Math.sin(pr.angle) * pr.speed,
        damageType: pr.damageType,
        damage: pr.dmg,
        targetId: pr.targetId,
      })),
      effects: this.effects.map((e) => ({ id: e.id, kind: e.kind, x: e.x, y: e.y })),
      simTime: this.simTime,
    };
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
      targetId: null,
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

// ---- The debug snapshot shape (specs/instrumentation.md) ------------------------
// The JSON-serializable state the debug API's snapshot() and the debug overlay report.

// The matter `type` as reported to the snapshot: the internal "heavy" isotope reads as
// "isotope" on the surface (its `traits.heavy` flag still marks the trait).
export type MatterSnapType = "atom" | "dimer" | "polymer" | "noble" | "isotope" | "chelate" | "shroud" | "macromass";

export interface MatterSnapshot {
  id: number;
  type: MatterSnapType;
  x: number;
  y: number;
  pathId: number;
  progress: number;
  speed: number;
  baseSpeed: number;
  hp: number;
  maxHp: number;
  electrons: number | null;
  bond: number | null;
  maxBond: number | null;
  traits: { bonded: boolean; heavy: boolean; inert: boolean };
  revealed: boolean;
  slow: number;
  damageBonus: number;
}

export interface TowerSnapshot {
  id: number;
  type: TowerKind;
  x: number;
  y: number;
  tier: number;
  branch: Branch | null;
  damageType: DamageType | null;
  range: number;
  damage: number;
  fireRate: number;
  targeting: TargetingMode | null;
  inertPriority: boolean;
  angle: number | null;
  targetId: number | null;
  cooldown: number;
  spent: number;
}

export interface ProjectileSnapshot {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  damageType: DamageType;
  damage: number;
  targetId: number | null;
}

export interface MapSnapshot {
  id: string;
  name: string;
  difficulty: "easy" | "medium" | "hard";
  topology: "single" | "branching" | "multiple";
  style: "curved" | "straight";
}

export interface PathSnapshot {
  id: number;
  length: number;
  points: { x: number; y: number }[];
}

export interface ValenceSnapshot {
  version: number;
  screen: GameState;
  paused: boolean;
  phase: Phase;
  maps: MapSnapshot[];
  map: string | null;
  speed: number;
  muted: boolean;
  energy: number;
  integrity: number;
  score: number;
  round: number;
  totalRounds: number;
  buildCountdown: number | null;
  result: "victory" | "defeat" | null;
  paths: PathSnapshot[];
  matter: MatterSnapshot[];
  towers: TowerSnapshot[];
  projectiles: ProjectileSnapshot[];
  effects: { id: number; kind: EffectKind; x: number; y: number }[];
  simTime: number;
}
