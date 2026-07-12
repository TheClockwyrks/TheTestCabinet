// Valence — the simulation (specs/matter.md, specs/towers.md, specs/flow.md).
//
// A fixed-step model of matter flowing along the branching conduit, grid-placed towers
// firing automatically, the three-axis decomposition model (shear / ionize / fission),
// the Catalyst and Moderator auras, the energy/interest/integrity economy, and the
// 20-round campaign with its fragmenting boss. Rendering, audio, and particles read
// this state and drain its event queues; the simulation itself is DOM-free.

import {
  BUILD_PHASE_SECONDS,
  CATALYST_EXCITE_BONUS,
  CATALYST_LINGER,
  FIRERATE_MULT,
  FISSION_SPLASH,
  FRAGMENT_SPEED_BONUS,
  HEAVY_DAUGHTER_SHELLS,
  HEAVY_SLOW,
  INTEREST_CAP,
  INTEREST_RATE,
  MATTER,
  MAX_ATOM_SPEED,
  MODERATOR_SLOW,
  PROJECTILE_SPEED,
  RANGE_PER_LEVEL,
  STRIP_SPEED_BONUS,
  TOTAL_ROUNDS,
  TOWERS,
  UPGRADE_MULT,
  roundClearBonus,
  scaledAtoms,
  scaledCriticality,
  scaledShells,
  type MatterType,
  type TowerKind,
} from "./constants";
import { cellCenter, isBlocked, laneLength, sampleLane, type Lane } from "./board";
import type { CampaignMode } from "./mode";
import { buildWave, type Wave } from "./waves";
import type {
  AtomSpec,
  Cue,
  FxEvent,
  GameState,
  Phase,
  Projectile,
  Tower,
  Unit,
} from "./types";

export class Game {
  readonly mode: CampaignMode;
  state: GameState = "title";
  phase: Phase = "build";

  energy = 0;
  integrity = 0;
  maxIntegrity = 0;
  score = 0;
  round = 0; // 0 before Round 1 (the opening build phase)
  speed = 1; // 1 / 2 / 3

  units: Unit[] = [];
  projectiles: Projectile[] = []; // shots in flight (specs/towers.md)
  towers = new Map<number, Tower>(); // cell id → tower

  // Build / selection UI state.
  buildKind: TowerKind | null = null;
  selectedCell: number | null = null;
  hoverShop: TowerKind | null = null;
  hoverCell: number | null = null;
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

  // Event queues drained by the presentation layer each frame.
  fxQueue: FxEvent[] = [];
  sndQueue: Cue[] = [];

  constructor(mode: CampaignMode) {
    this.mode = mode;
    this.nextWave = buildWave(1, mode);
  }

  // ---- Lifecycle --------------------------------------------------------------
  start(): void {
    this.state = "playing";
    this.phase = "build";
    this.energy = this.mode.startEnergy;
    this.integrity = this.mode.startIntegrity;
    this.maxIntegrity = this.mode.startIntegrity;
    this.score = 0;
    this.round = 0;
    this.speed = 1;
    this.units = [];
    this.projectiles = [];
    this.towers.clear();
    this.buildKind = null;
    this.selectedCell = null;
    this.hoverShop = null;
    this.hoverCell = null;
    this.wave = null;
    this.nextWave = buildWave(1, this.mode);
    this.spawnCursor = 0;
    this.spawned = 0;
    this.waveClock = 0;
    // The opening build phase is untimed (specs/flow.md).
    this.buildTimed = false;
    this.buildTimer = 0;
  }

  // ---- Fixed simulation step --------------------------------------------------
  fixedStep(dt: number): void {
    if (this.state !== "playing") return;

    if (this.phase === "build") {
      if (this.buildTimed) {
        this.buildTimer -= dt;
        if (this.buildTimer <= 0) this.beginRound(0);
      }
      // Towers still animate their idle fire timers down; nothing to fire at.
      for (const t of this.towers.values()) t.fireAnim += dt;
      return;
    }

    // Round phase.
    this.waveClock += dt * 1000;
    this.spawnDue();
    this.stepAuras();
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
      this.units.push(this.makeUnit(e.type, e.lane));
      this.spawned++;
      this.spawnCursor++;
    }
  }

  // ---- Unit construction ------------------------------------------------------
  private makeUnit(type: MatterType, lane: Lane): Unit {
    const def = MATTER[type];
    const r = this.round;
    const u: Unit = {
      id: this.nextId++,
      type,
      form: def.form,
      lane,
      s: 0,
      element: def.element,
      baseSpeed: def.speed,
      shells: 0,
      atoms: [],
      criticality: 0,
      critThreshold: 0,
      reactive: false,
      reactiveTimer: 0,
      excited: false,
      excitedBonus: 0,
      slowFactor: 1,
      radius: def.radius,
      fragmentsShed: 0,
      fragmentTarget: 0,
      animT: 0,
      hitFlash: 0,
      dead: false,
    };
    if (def.form === "atom") {
      u.shells = scaledShells(def.shells, r);
    } else if (def.form === "inert") {
      u.shells = scaledShells(def.shells, r); // shells once reactive
    } else if (def.form === "molecule") {
      const n = scaledAtoms(def.atoms, r);
      const shells = scaledShells(2, r);
      u.atoms = Array.from({ length: n }, () => ({ element: def.element, shells }) as AtomSpec);
    } else if (def.form === "heavy") {
      u.critThreshold = scaledCriticality(def.criticality, r);
    } else if (def.form === "boss") {
      u.critThreshold = scaledCriticality(def.criticality, r) + (r >= 20 ? 3 : 0);
      u.fragmentTarget = u.critThreshold;
    }
    return u;
  }

  private makeFreeAtom(lane: Lane, s: number, element: 0 | 1, shells: number, speed: number): Unit {
    return {
      id: this.nextId++,
      type: "monatom",
      form: "atom",
      lane,
      s,
      element,
      baseSpeed: Math.min(MAX_ATOM_SPEED, speed),
      shells: Math.max(1, shells),
      atoms: [],
      criticality: 0,
      critThreshold: 0,
      reactive: true,
      reactiveTimer: 0,
      excited: false,
      excitedBonus: 0,
      slowFactor: 1,
      radius: 10,
      fragmentsShed: 0,
      fragmentTarget: 0,
      animT: 0,
      hitFlash: 0,
      dead: false,
    };
  }

  // ---- Auras (Catalyst / Moderator) applied before movement -------------------
  private stepAuras(): void {
    // Reset per-tick aura state, decay lingering reactivity.
    for (const u of this.units) {
      u.slowFactor = 1;
      u.excited = false;
      u.excitedBonus = 0;
      if (u.form === "inert" && u.reactive) {
        u.reactiveTimer -= 1 / 60; // decays unless re-topped by a field below
        if (u.reactiveTimer <= 0) u.reactive = false; // re-seals (specs/towers.md)
      }
    }
    for (const t of this.towers.values()) {
      if (t.kind === "catalyst") {
        const bonus = CATALYST_EXCITE_BONUS[t.level - 1]!;
        for (const u of this.unitsInRange(t)) {
          if (u.form === "inert") {
            u.reactive = true;
            u.reactiveTimer = CATALYST_LINGER;
          }
          u.excited = true;
          u.excitedBonus = Math.max(u.excitedBonus, bonus);
        }
      } else if (t.kind === "moderator") {
        const factor = MODERATOR_SLOW[t.level - 1]!;
        for (const u of this.unitsInRange(t)) {
          if (u.form === "boss") continue; // immune
          const applied = u.form === "heavy" ? Math.max(HEAVY_SLOW, factor) : factor;
          u.slowFactor = Math.min(u.slowFactor, applied);
        }
      }
    }
  }

  private *unitsInRange(t: Tower): Generator<Unit> {
    const r2 = t.range * t.range;
    for (const u of this.units) {
      if (u.dead) continue;
      const p = sampleLane(u.lane, u.s);
      const dx = p.x - t.x;
      const dy = p.y - t.y;
      if (dx * dx + dy * dy <= r2) yield u;
    }
  }

  // ---- Tower fire -------------------------------------------------------------
  private stepTowers(dt: number): void {
    for (const t of this.towers.values()) {
      t.fireAnim += dt;
      if (t.kind === "catalyst" || t.kind === "moderator") continue; // auras don't fire or aim
      const target = this.pickTarget(t);
      // The head tracks the current target and keeps its last heading when idle
      // (specs/towers.md).
      if (target) {
        const p = sampleLane(target.lane, target.s);
        t.aimAngle = Math.atan2(p.y - (t.y - 4), p.x - t.x);
      }
      t.cooldown -= dt;
      if (t.cooldown > 0 || !target) continue;
      t.cooldown = 1 / t.fireRate;
      t.fireAnim = 0;
      this.launchProjectile(t, target);
    }
  }

  // Launch a shot from the tower's muzzle toward `target`. The projectile — not this
  // call — deals the damage, on impact (specs/towers.md).
  private launchProjectile(t: Tower, target: Unit): void {
    const speed = PROJECTILE_SPEED[t.kind as "ionizer" | "shear" | "fission"];
    const muzzle = 14; // barrel length from the head centre
    const cx = t.x + Math.cos(t.aimAngle) * muzzle;
    const cy = t.y - 4 + Math.sin(t.aimAngle) * muzzle;
    this.projectiles.push({
      id: this.nextId++,
      kind: t.kind as "ionizer" | "shear" | "fission",
      level: t.level,
      x: cx,
      y: cy,
      angle: t.aimAngle,
      speed,
      targetId: target.id,
      dead: false,
    });
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
      const p = sampleLane(target.lane, target.s);
      const dx = p.x - pr.x;
      const dy = p.y - pr.y;
      const dist = Math.hypot(dx, dy) || 1;
      const step = pr.speed * dt;
      pr.angle = Math.atan2(dy, dx);
      if (dist <= step + target.radius) {
        // Impact: the projectile connects and applies the tower's effect here.
        pr.x = p.x;
        pr.y = p.y;
        pr.dead = true;
        this.applyHit(pr, target);
      } else {
        pr.x += (dx / dist) * step;
        pr.y += (dy / dist) * step;
      }
    }
  }

  private unitById(id: number): Unit | null {
    for (const u of this.units) if (u.id === id) return u;
    return null;
  }

  private pickTarget(t: Tower): Unit | null {
    // The valid in-range unit furthest along the conduit (standard "first").
    let best: Unit | null = null;
    for (const u of this.unitsInRange(t)) {
      if (!this.isValidTarget(t.kind, u)) continue;
      if (!best || u.s > best.s) best = u;
    }
    return best;
  }

  private isValidTarget(kind: TowerKind, u: Unit): boolean {
    if (u.dead) return false;
    switch (kind) {
      case "ionizer":
        // Free reactive atoms only: a plain atom (always reactive) or a catalyzed noble.
        return u.form === "atom" || (u.form === "inert" && u.reactive);
      case "shear":
        return u.form === "molecule";
      case "fission":
        return u.form === "heavy" || u.form === "boss";
      default:
        return false;
    }
  }

  // Apply a landed shot's effect. `src` is the firing tower's kind+level snapshot,
  // carried by the projectile so the effect is right on impact (specs/towers.md).
  private applyHit(src: { kind: TowerKind; level: 1 | 2 | 3 }, u: Unit): void {
    u.hitFlash = 0;
    const p = sampleLane(u.lane, u.s);
    if (src.kind === "ionizer") {
      const baseStrip = src.level >= 3 ? 2 : 1;
      const strip = baseStrip + (u.excited ? u.excitedBonus : 0);
      u.shells -= strip;
      if (u.shells <= 0) {
        this.neutralize(u);
      } else {
        u.baseSpeed = Math.min(MAX_ATOM_SPEED, u.baseSpeed + STRIP_SPEED_BONUS);
        this.fxQueue.push({ kind: "ionize", x: p.x, y: p.y });
      }
    } else if (src.kind === "shear") {
      const bonds = src.level >= 3 ? 2 : 1;
      this.shear(u, bonds);
    } else if (src.kind === "fission") {
      this.fission(u, src);
    }
  }

  // ---- Decomposition ----------------------------------------------------------
  private neutralize(u: Unit): void {
    u.dead = true;
    const def = MATTER[u.type];
    // A freed/daughter atom is a "monatom" clone; pay the source atom's value. To keep
    // the economy faithful, a fragment atom pays the monatom bounty (2).
    const bounty = u.form === "atom" && u.type === "monatom" ? MATTER.monatom.energy : def.energy;
    // Molecules/heavies never neutralize directly (they decompose first), so `def` is an
    // atom/noble here; pay its listed energy (noble 6, monatom/swift 2).
    const pay = u.type === "noble" ? MATTER.noble.energy : bounty;
    this.energy += pay;
    this.score += pay;
    const p = sampleLane(u.lane, u.s);
    this.fxQueue.push({ kind: "neutralize", x: p.x, y: p.y });
    this.sndQueue.push("neutralize");
  }

  private shear(u: Unit, bonds: number): void {
    const p = sampleLane(u.lane, u.s);
    let broke = false;
    for (let i = 0; i < bonds && u.atoms.length > 1; i++) {
      const lead = u.atoms.shift()!;
      const atom = this.makeFreeAtom(u.lane, u.s + 4, lead.element, lead.shells, u.baseSpeed + FRAGMENT_SPEED_BONUS);
      this.units.push(atom);
      broke = true;
    }
    if (u.atoms.length <= 1) {
      // The molecule is down to its last atom — it becomes free.
      const last = u.atoms[0] ?? { element: u.element, shells: scaledShells(2, this.round) };
      u.form = "atom";
      u.type = "monatom";
      u.element = last.element;
      u.shells = last.shells;
      u.reactive = true;
      u.baseSpeed = Math.min(MAX_ATOM_SPEED, u.baseSpeed + FRAGMENT_SPEED_BONUS);
      u.atoms = [];
      broke = true;
    }
    if (broke) {
      this.fxQueue.push({ kind: "bondsnap", x: p.x, y: p.y });
      this.sndQueue.push("snap");
    }
  }

  private fission(u: Unit, src: { level: 1 | 2 | 3 }): void {
    const p = sampleLane(u.lane, u.s);
    u.criticality += 1;

    // Splash: +1 criticality to other heavies within the level's splash radius.
    const splash = FISSION_SPLASH[src.level - 1]!;
    if (u.form === "heavy") {
      for (const other of this.units) {
        if (other === u || other.dead || other.form !== "heavy") continue;
        const q = sampleLane(other.lane, other.s);
        if (Math.hypot(q.x - p.x, q.y - p.y) <= splash) other.criticality += 1;
      }
    }

    if (u.form === "boss") {
      // The boss fountains matter: each hit sheds a fragment; the final hit bursts it.
      this.fxQueue.push({ kind: "fission", x: p.x, y: p.y });
      this.sndQueue.push("fission");
      if (u.criticality >= u.critThreshold) {
        // Final split: a burst of fragments, then the core is destroyed and pays out.
        for (let i = 0; i < 3; i++) this.shedBossFragment(u, i);
        this.energy += MATTER.macromass.energy;
        this.score += MATTER.macromass.energy;
        u.dead = true;
      } else {
        this.shedBossFragment(u, u.fragmentsShed);
        u.fragmentsShed++;
      }
      return;
    }

    // A heavy nucleus.
    if (u.criticality >= u.critThreshold) {
      u.dead = true;
      this.fxQueue.push({ kind: "fission", x: p.x, y: p.y });
      this.sndQueue.push("fission");
      const shells = scaledShells(HEAVY_DAUGHTER_SHELLS, this.round);
      for (let i = 0; i < 2; i++) {
        const d = this.makeFreeAtom(u.lane, u.s + (i === 0 ? -6 : 6), (i % 2) as 0 | 1, shells, u.baseSpeed + FRAGMENT_SPEED_BONUS);
        this.units.push(d);
      }
    } else {
      this.fxQueue.push({ kind: "fission", x: p.x, y: p.y });
      this.sndQueue.push("fission");
    }
  }

  private shedBossFragment(u: Unit, idx: number): void {
    const behind = u.s - 8 - idx * 6;
    if (idx % 2 === 0) {
      // A Dimer.
      const shells = scaledShells(2, this.round);
      const mol = this.makeUnit("dimer", u.lane);
      mol.s = behind;
      mol.atoms = [
        { element: 0, shells },
        { element: 1, shells },
      ];
      this.units.push(mol);
    } else {
      // A pair of free atoms.
      const shells = scaledShells(2, this.round);
      this.units.push(this.makeFreeAtom(u.lane, behind, 0, shells, MATTER.monatom.speed + FRAGMENT_SPEED_BONUS));
      this.units.push(this.makeFreeAtom(u.lane, behind - 6, 1, shells, MATTER.monatom.speed + FRAGMENT_SPEED_BONUS));
    }
  }

  // ---- Movement / leaks -------------------------------------------------------
  private stepUnits(dt: number): void {
    for (const u of this.units) {
      if (u.dead) continue;
      u.animT += dt;
      u.hitFlash += dt;
      const v = u.baseSpeed * u.slowFactor;
      u.s += v * dt;
      const len = laneLength(u.lane);
      if (u.s >= len) this.leak(u);
    }
  }

  private leak(u: Unit): void {
    u.dead = true;
    const def = MATTER[u.type];
    this.integrity -= def.leak;
    const p = sampleLane(u.lane, laneLength(u.lane));
    this.fxQueue.push({ kind: "leak", x: p.x, y: p.y });
    this.sndQueue.push("alarm");
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
    this.projectiles = []; // no shots carry over into the build phase
    if (this.round >= TOTAL_ROUNDS) {
      this.win();
      return;
    }
    // Enter the next between-round build phase.
    this.phase = "build";
    this.buildTimed = true;
    this.buildTimer = BUILD_PHASE_SECONDS;
    this.nextWave = buildWave(this.round + 1, this.mode);
    // Interest at the start of the build phase (specs/flow.md; a mode may disable it).
    if (this.mode.interest) {
      this.energy += Math.min(INTEREST_CAP, Math.floor(this.energy * INTEREST_RATE));
    }
    // Towers placed on the round that just ran are no longer fully refundable.
    for (const t of this.towers.values()) t.refundable = false;
  }

  // Begin the next round. `earlySeconds` is the whole seconds left on the countdown
  // when the player sent it early (0 when the timer expired or from the opening phase).
  private beginRound(earlySeconds: number): void {
    if (earlySeconds > 0) this.energy += earlySeconds; // early-send bonus
    this.round += 1;
    this.phase = "round";
    this.wave = this.nextWave;
    this.spawnCursor = 0;
    this.spawned = 0;
    this.waveClock = 0;
    this.buildTimed = false;
    this.buildTimer = 0;
    // The coming-round preview now points at the round after this one.
    this.nextWave = buildWave(Math.min(this.round + 1, TOTAL_ROUNDS), this.mode);
    // Any tower still standing has now faced a round → 70% refund from here on.
    for (const t of this.towers.values()) t.refundable = false;
  }

  // ---- Dev/proof helpers (never used in normal play) --------------------------
  devGrant(energy: number, integrity: number): void {
    this.energy = energy;
    this.integrity = integrity;
    this.maxIntegrity = Math.max(this.maxIntegrity, integrity);
  }
  devBeginRound(n: number): void {
    this.round = n - 1;
    this.nextWave = buildWave(n, this.mode);
    this.phase = "build";
    this.buildTimed = false;
    this.startRound();
  }
  // Mark the current round finished so the next fixedStep runs the real end-of-round
  // path (round-clear bonus → next build phase, or victory after round 20).
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
    this.wave = null;
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
    this.selectedCell = null;
  }

  cancelBuild(): void {
    this.buildKind = null;
  }

  // A click on grid cell `id` (specs/board.md): build it while holding a tower, else
  // select the tower there (or deselect on an empty cell).
  clickCell(id: number): void {
    if (this.state !== "playing") return;
    const existing = this.towers.get(id);
    if (this.buildKind) {
      if (!existing) this.build(id, this.buildKind); // build() refuses blocked/unaffordable
      return;
    }
    this.selectedCell = existing ? id : null;
  }

  clickEmptyBoard(): void {
    if (this.buildKind) this.buildKind = null;
    else this.selectedCell = null;
  }

  // Whether a cell can currently take a new tower of `kind`: on the grid, not crossed by
  // the conduit, not already occupied, and affordable.
  canBuild(id: number, kind: TowerKind): boolean {
    return !isBlocked(id) && !this.towers.has(id) && this.energy >= TOWERS[kind].cost;
  }

  private build(cellId: number, kind: TowerKind): void {
    if (!this.canBuild(cellId, kind)) return;
    const def = TOWERS[kind];
    const c = cellCenter(cellId);
    this.energy -= def.cost;
    this.towers.set(cellId, {
      cell: cellId,
      kind,
      level: 1,
      x: c.x,
      y: c.y,
      range: def.range,
      fireRate: def.fireRate,
      cooldown: 0,
      spent: def.cost,
      placedInBuildPhaseOf: this.round,
      refundable: this.phase === "build",
      fireAnim: 999,
      aimAngle: -Math.PI / 2,
    });
    this.selectedCell = cellId;
    this.sndQueue.push("build");
  }

  upgradeCost(t: Tower): number | null {
    if (t.level >= 3) return null;
    return Math.round(TOWERS[t.kind].cost * UPGRADE_MULT[t.level + 1]!);
  }

  upgradeSelected(): void {
    if (this.selectedCell == null) return;
    const t = this.towers.get(this.selectedCell);
    if (!t || t.level >= 3) return;
    const cost = this.upgradeCost(t);
    if (cost == null || this.energy < cost) return;
    this.energy -= cost;
    t.spent += cost;
    t.level = (t.level + 1) as 1 | 2 | 3;
    // Re-derive stats from base with the per-level modifiers (specs/towers.md).
    const def = TOWERS[t.kind];
    t.range = def.range + RANGE_PER_LEVEL[t.kind] * (t.level - 1);
    t.fireRate = def.fireRate * Math.pow(FIRERATE_MULT[t.kind], t.level - 1);
    this.sndQueue.push("build");
  }

  sellRefund(t: Tower): number {
    return t.refundable ? t.spent : Math.floor(t.spent * 0.7);
  }

  sellSelected(): void {
    if (this.selectedCell == null) return;
    const t = this.towers.get(this.selectedCell);
    if (!t) return;
    this.energy += this.sellRefund(t);
    this.towers.delete(this.selectedCell);
    this.selectedCell = null;
    this.sndQueue.push("build");
  }

  cycleSpeed(): void {
    this.speed = this.speed >= 3 ? 1 : this.speed + 1;
  }

  // ---- Derived reads for the HUD ---------------------------------------------
  get selectedTower(): Tower | null {
    return this.selectedCell != null ? (this.towers.get(this.selectedCell) ?? null) : null;
  }
  get comingRound(): Wave {
    return this.nextWave;
  }
  roundProgress(): number {
    const w = this.wave;
    if (!w || w.events.length === 0) return 0;
    return Math.min(1, this.spawnCursor / w.events.length);
  }
}
