// Arc Foundry — the simulation (specs/board.md, specs/towers.md, specs/build.md,
// specs/flow.md).
//
// A fixed-step model of the Load mazing the ordered-waypoint chain around the walls, the
// scrap-press random build, the keep / slag / combine quality ladder, five components firing
// automatically with travelling projectiles / arcs, the economy and Grid Integrity, and the
// wave campaign with its Dynamo boss. The simulation is DOM-free and its control API is
// INPUT-FREE and DETERMINISTIC — no pointer, no clock, no rng from the wall — so the browser
// and the headless balance harness drive it identically: a fixed seed + a fixedStep(dt) loop
// reproduces a match exactly. Rendering, audio, and particles read this state and drain its
// fx/sound queues each frame.

import {
  BUILDS_PER_LEVEL,
  BUILD_PHASE_SECONDS,
  COMPONENT_ORDER,
  DEFAULT_MAP,
  DIFFICULTY,
  EARLY_SEND_PER_SECOND,
  INTEREST_CAP,
  INTEREST_RATE,
  LOAD,
  MAX_TIER,
  PROJECTILE_SPEED,
  SCORE_PER_INTEGRITY,
  SCORE_PER_WAVE,
  SLAG_REFUND,
  SLAG_WALL_SELL,
  STAMP_COST,
  STAMP_QUALITY_WEIGHT,
  STAMP_TYPE_WEIGHT,
  TARGETING_ORDER,
  deriveStats,
  footprintCenter,
  investedValue,
  scaledHp,
  sellRefund,
  tileCenter,
  waveClearBonus,
  type CompStats,
  type DifficultyDef,
} from "./constants";
import { Board, type Occupancy } from "./board";
import type { Campaign } from "./mode";
import { buildWave } from "./waves";
import type { Wave } from "./types";
import type {
  Component,
  ComponentType,
  Cue,
  FxEvent,
  GameState,
  MapDef,
  Phase,
  Projectile,
  SlagWall,
  Structure,
  TargetingMode,
  Tier,
  Unit,
} from "./types";
import { Rng } from "./rng";

// The seed for the scrap-press roll. Fixed so a given sequence of press pulls / placements
// reproduces exactly; the wave composition seeds itself per wave (waves.ts).
const PRESS_SEED = 0x51a6c0de;

// A rolled-but-not-yet-placed stamp held on the cursor after a press pull (specs/build.md,
// specs/controls.md). Its type + quality are fixed at the pull; it must be placed.
export interface HeldStamp {
  type: ComponentType;
  tier: Tier;
}

export class Game {
  readonly campaign: Campaign;
  map: MapDef; // the chosen yard (specs/board.md); set by startOn() before a run
  board: Board; // the grid, waypoint chain, and pathing of the current map
  diff: DifficultyDef = DIFFICULTY.medium; // the chosen difficulty (specs/modes.md)

  state: GameState = "title";
  phase: Phase = "build";
  paused = false;

  charge = 0; // money (specs/flow.md)
  integrity = 0; // Grid Integrity (lives)
  maxIntegrity = 0;
  score = 0;
  wave = 0; // 0 before Wave 1 (the untimed opening build phase)
  speed: 1 | 2 = 1;

  units: Unit[] = [];
  projectiles: Projectile[] = []; // shots / arcs in flight (specs/towers.md)
  structures: Structure[] = []; // active components AND slag walls — the maze (specs/board.md)

  // Build / selection UI state.
  held: HeldStamp | null = null; // the rolled stamp on the cursor, awaiting placement
  selectedId: number | null = null;
  stampsUsed = 0; // press pulls spent of the level's BUILDS_PER_LEVEL allowance
  pointerX = -1; // logical-space pointer, for the held-stamp ghost / range preview
  pointerY = -1;

  buildTimer = 0; // seconds left in a between-wave build phase (0 = untimed opening)
  buildTimed = false;

  // Run tallies surfaced to the balance harness / HUD.
  kills = 0;
  leakCount = 0;

  // Event queues drained by the presentation layer each frame.
  fxQueue: FxEvent[] = [];
  sndQueue: Cue[] = [];

  // Internal, deterministic state (not part of the read surface).
  private activeWave: Wave | null = null;
  private nextWave: Wave;
  private spawnCursor = 0;
  private waveClock = 0; // ms into the active wave
  private nextId = 1;
  private press: Rng;
  private occ: Occupancy; // cached occupancy of the current structures + housings

  constructor(campaign: Campaign, map: MapDef = DEFAULT_MAP, diff: DifficultyDef = DIFFICULTY.medium) {
    this.campaign = campaign;
    this.map = map;
    this.diff = diff;
    this.board = new Board(map);
    this.press = new Rng(PRESS_SEED);
    this.nextWave = buildWave(1, diff);
    this.occ = this.board.occupancy([]);
  }

  // ---- Lifecycle --------------------------------------------------------------

  startOn(map: MapDef, diff: DifficultyDef): void {
    this.map = map;
    this.diff = diff;
    this.board = new Board(map);
    this.start();
  }

  start(): void {
    this.state = "playing";
    this.phase = "build";
    this.paused = false;
    this.charge = this.campaign.startCharge;
    this.integrity = this.campaign.startIntegrity;
    this.maxIntegrity = this.campaign.startIntegrity;
    this.score = 0;
    this.wave = 0;
    this.speed = 1;
    this.units = [];
    this.projectiles = [];
    this.structures = [];
    this.held = null;
    this.selectedId = null;
    this.stampsUsed = 0;
    this.pointerX = -1;
    this.pointerY = -1;
    this.buildTimer = 0;
    this.buildTimed = false; // the opening build phase is untimed (specs/flow.md)
    this.kills = 0;
    this.leakCount = 0;
    this.fxQueue = [];
    this.sndQueue = [];
    this.activeWave = null;
    this.spawnCursor = 0;
    this.waveClock = 0;
    this.nextId = 1;
    this.press = new Rng(PRESS_SEED);
    this.nextWave = buildWave(1, this.diff);
    this.occ = this.board.occupancy(this.structures);
  }

  // ---- Fixed simulation step (specs/controls.md) ------------------------------
  fixedStep(dt: number): void {
    if (this.state !== "playing" || this.paused) return;

    if (this.phase === "build") {
      if (this.buildTimed) {
        this.buildTimer -= dt;
        if (this.buildTimer <= 0) this.beginWave(0);
      }
      for (const s of this.structures) if (s.kind === "component") s.fireAnim += dt;
      return;
    }

    // Wave phase.
    this.waveClock += dt * 1000;
    this.spawnDue();
    this.stepComponents(dt);
    this.stepUnits(dt);
    this.stepProjectiles(dt); // move shots after units move, so homing stays accurate
    this.cullDead();
    this.checkWaveEnd();
    if (this.integrity <= 0) this.lose();
  }

  private spawnDue(): void {
    const w = this.activeWave;
    if (!w) return;
    while (this.spawnCursor < w.events.length && w.events[this.spawnCursor]!.atMs <= this.waveClock) {
      this.units.push(this.makeUnit(w.events[this.spawnCursor]!.type));
      this.spawnCursor++;
    }
  }

  // ---- Unit construction ------------------------------------------------------
  private makeUnit(type: Unit["type"]): Unit {
    const def = LOAD[type];
    const hp = scaledHp(def.baseHp, this.wave, this.diff.baseMult, this.diff.k);
    const entry = this.board.chain[0]!;
    const c = tileCenter(entry.col, entry.row);
    const u: Unit = {
      id: this.nextId++,
      type,
      flies: def.flies,
      hp,
      maxHp: hp,
      speed: def.speed,
      bounty: def.bounty,
      leak: def.leak,
      radius: def.radius,
      x: c.x,
      y: c.y,
      wpIndex: 1, // heading to chain[1] = WP1 (chain[0] is the Entry it spawns on)
      route: [],
      routeStep: 0,
      progress: 0,
      animT: 0,
      hitFlash: 999,
      dead: false,
    };
    u.route = this.board.routeFor({ x: u.x, y: u.y }, u.wpIndex, this.occ, u.flies);
    u.progress = this.progressOf(u);
    return u;
  }

  // ---- Re-path (specs/board.md §3.5) ------------------------------------------
  // Rebuild the cached occupancy and re-route every walking unit from where it stands —
  // called whenever the maze changes (stamp, slag, combine, sell).
  private rePath(): void {
    this.occ = this.board.occupancy(this.structures);
    for (const u of this.units) {
      if (u.dead) continue;
      u.route = this.board.routeFor({ x: u.x, y: u.y }, u.wpIndex, this.occ, u.flies);
      u.routeStep = 0;
    }
  }

  // ---- Component fire (specs/towers.md) ---------------------------------------
  private stepComponents(dt: number): void {
    for (const s of this.structures) {
      if (s.kind !== "component") continue;
      const c = s;
      c.fireAnim += dt;
      const stats = deriveStats(c.type, c.tier);
      const center = footprintCenter(c.col, c.row);
      const target = this.pickTarget(c, stats, center);
      if (target) c.aimAngle = Math.atan2(target.y - center.y, target.x - center.x);
      c.cooldown -= dt;
      if (c.cooldown > 0 || !target) continue;
      c.cooldown = 1 / stats.fireRate;
      c.fireAnim = 0;
      this.launchProjectile(c, stats, center, target);
    }
  }

  // The valid in-range unit this component fires at, under its targeting priority.
  private pickTarget(c: Component, stats: CompStats, center: { x: number; y: number }): Unit | null {
    const r2 = stats.range * stats.range;
    let best: Unit | null = null;
    for (const u of this.units) {
      if (u.dead) continue;
      const dx = u.x - center.x;
      const dy = u.y - center.y;
      if (dx * dx + dy * dy > r2) continue;
      if (!best || this.better(c.targeting, u, best, center)) best = u;
    }
    return best;
  }

  // Is candidate `a` a better target than the incumbent `b` under `mode`? (specs/towers.md:
  // FIRST = furthest along the chain, LAST = least far, NEAREST = closest, STRONGEST /
  // WEAKEST = most / least remaining HP.) Ties keep the earlier-found unit for determinism.
  private better(mode: TargetingMode, a: Unit, b: Unit, center: { x: number; y: number }): boolean {
    switch (mode) {
      case "first":
        return a.progress > b.progress;
      case "last":
        return a.progress < b.progress;
      case "nearest":
        return this.dist2(a, center) < this.dist2(b, center);
      case "strongest":
        return a.hp > b.hp;
      case "weakest":
        return a.hp < b.hp;
      default:
        return false;
    }
  }

  private dist2(u: Unit, center: { x: number; y: number }): number {
    const dx = u.x - center.x;
    const dy = u.y - center.y;
    return dx * dx + dy * dy;
  }

  private launchProjectile(c: Component, stats: CompStats, center: { x: number; y: number }, target: Unit): void {
    const muzzle = 16;
    const mx = center.x + Math.cos(c.aimAngle) * muzzle;
    const my = center.y + Math.sin(c.aimAngle) * muzzle;
    this.projectiles.push({
      id: this.nextId++,
      type: c.type,
      tier: c.tier,
      dmg: stats.dmg,
      x: mx,
      y: my,
      angle: c.aimAngle,
      speed: PROJECTILE_SPEED[c.type],
      targetId: target.id,
      splash: stats.splash,
      chain: stats.chainLeaps,
      chainRange: stats.chainRange,
      chainFalloff: stats.chainFalloff,
      hitIds: [],
      dead: false,
    });
    // Fire VFX + sound cue, keyed on the component's firing identity (specs/assets.md §11.3).
    this.fxQueue.push({ kind: "muzzle", x: mx, y: my, tier: c.tier });
    switch (c.type) {
      case "capacitor":
        this.fxQueue.push({ kind: "arcbolt", x: mx, y: my, x2: target.x, y2: target.y, tier: c.tier });
        this.sndQueue.push("zap");
        break;
      case "discharge":
        this.fxQueue.push({ kind: "arcbolt", x: mx, y: my, x2: target.x, y2: target.y, tier: c.tier, big: true });
        this.sndQueue.push("discharge");
        break;
      case "emitter":
        this.fxQueue.push({ kind: "spray", x: mx, y: my, x2: target.x, y2: target.y, tier: c.tier });
        this.sndQueue.push("zap");
        break;
      case "coil":
        this.sndQueue.push("chain"); // the chain arcs are emitted at impact, unit-to-unit
        break;
      case "arcnode":
        this.sndQueue.push("discharge"); // the discharge ring is emitted at impact
        break;
      default:
        break;
    }
  }

  // ---- Projectiles in flight (specs/towers.md) --------------------------------
  private stepProjectiles(dt: number): void {
    for (const pr of this.projectiles) {
      if (pr.dead) continue;
      const target = this.unitById(pr.targetId);
      if (!target || target.dead) {
        pr.dead = true; // the target is gone — the shot misses
        continue;
      }
      const dx = target.x - pr.x;
      const dy = target.y - pr.y;
      const dist = Math.hypot(dx, dy) || 1;
      const step = pr.speed * dt;
      pr.angle = Math.atan2(dy, dx);
      if (dist <= step + target.radius) {
        pr.x = target.x;
        pr.y = target.y;
        pr.dead = true;
        this.onImpact(pr, target);
      } else {
        pr.x += (dx / dist) * step;
        pr.y += (dy / dist) * step;
      }
    }
  }

  private onImpact(pr: Projectile, primary: Unit): void {
    this.hit(pr, primary, pr.dmg);
    this.fxQueue.push({ kind: "impact", x: pr.x, y: pr.y, tier: pr.tier });

    // Arc-Node: an expanding discharge ring dealing full damage to every unit in the splash
    // radius of the impact point (specs/towers.md §5.3).
    if (pr.splash > 0) {
      this.fxQueue.push({ kind: "ring", x: pr.x, y: pr.y, tier: pr.tier });
      for (const u of this.units) {
        if (u.dead || pr.hitIds.includes(u.id)) continue;
        if (Math.hypot(u.x - pr.x, u.y - pr.y) <= pr.splash) {
          this.hit(pr, u, pr.dmg);
          this.fxQueue.push({ kind: "impact", x: u.x, y: u.y, tier: pr.tier });
        }
      }
    }

    // Coil: the bolt leaps to the nearest not-yet-hit unit within chainRange, each leap
    // dealing ×chainFalloff of the previous (specs/towers.md §5.3).
    if (pr.chain > 0) {
      let leaps = pr.chain;
      let fx = pr.x;
      let fy = pr.y;
      let dmg = pr.dmg;
      while (leaps > 0) {
        let bestU: Unit | null = null;
        let bestD = Infinity;
        for (const u of this.units) {
          if (u.dead || pr.hitIds.includes(u.id)) continue;
          const d = Math.hypot(u.x - fx, u.y - fy);
          if (d <= pr.chainRange && d < bestD) {
            bestD = d;
            bestU = u;
          }
        }
        if (!bestU) break;
        dmg *= pr.chainFalloff;
        this.fxQueue.push({ kind: "chain", x: fx, y: fy, x2: bestU.x, y2: bestU.y, tier: pr.tier });
        this.hit(pr, bestU, dmg);
        this.fxQueue.push({ kind: "impact", x: bestU.x, y: bestU.y, tier: pr.tier });
        fx = bestU.x;
        fy = bestU.y;
        leaps--;
      }
    }
  }

  // Apply one landed shot to one unit (once), removing HP and killing it if it hits zero.
  private hit(pr: Projectile, u: Unit, dmg: number): void {
    if (u.dead || pr.hitIds.includes(u.id)) return;
    pr.hitIds.push(u.id);
    u.hp -= dmg;
    u.hitFlash = 0;
    if (u.hp <= 0) this.kill(u);
  }

  private kill(u: Unit): void {
    u.dead = true;
    this.charge += u.bounty;
    this.score += u.bounty;
    this.kills++;
    this.fxQueue.push({ kind: "death", x: u.x, y: u.y, big: u.type === "dynamo" });
    this.sndQueue.push("kill");
  }

  private unitById(id: number): Unit | null {
    for (const u of this.units) if (u.id === id) return u;
    return null;
  }

  // ---- Movement / leaks (specs/board.md, specs/enemies.md) --------------------
  private stepUnits(dt: number): void {
    for (const u of this.units) {
      if (u.dead) continue;
      u.animT += dt;
      u.hitFlash += dt;
      this.moveUnit(u, dt);
      if (!u.dead) u.progress = this.progressOf(u);
    }
  }

  private moveUnit(u: Unit, dt: number): void {
    if (u.route.length === 0) {
      u.route = this.board.routeFor({ x: u.x, y: u.y }, u.wpIndex, this.occ, u.flies);
      u.routeStep = 0;
    }
    let budget = u.speed * dt;
    while (budget > 0 && u.routeStep < u.route.length) {
      const tgt = u.route[u.routeStep]!;
      const dx = tgt.x - u.x;
      const dy = tgt.y - u.y;
      const d = Math.hypot(dx, dy);
      if (d <= budget) {
        u.x = tgt.x;
        u.y = tgt.y;
        budget -= d;
        u.routeStep++;
      } else {
        u.x += (dx / d) * budget;
        u.y += (dy / d) * budget;
        budget = 0;
      }
    }
    if (u.routeStep >= u.route.length) {
      // Reached chain node `wpIndex`.
      if (u.wpIndex >= this.board.chain.length - 1) {
        this.leak(u); // reached the Collector
        return;
      }
      u.wpIndex++;
      u.route = this.board.routeFor({ x: u.x, y: u.y }, u.wpIndex, this.occ, u.flies);
      u.routeStep = 0;
    }
  }

  // A scalar "how far along the chain": waypoint index dominates, then the shorter the
  // remaining route to the next waypoint, the further along (specs/board.md targeting).
  private progressOf(u: Unit): number {
    let rem = 0;
    let px = u.x;
    let py = u.y;
    for (let i = u.routeStep; i < u.route.length; i++) {
      const p = u.route[i]!;
      rem += Math.hypot(p.x - px, p.y - py);
      px = p.x;
      py = p.y;
    }
    return u.wpIndex * 1e6 - rem;
  }

  private leak(u: Unit): void {
    u.dead = true;
    this.integrity -= u.leak;
    this.leakCount += u.leak;
    const c = this.board.chain[this.board.chain.length - 1]!;
    const p = tileCenter(c.col, c.row);
    this.fxQueue.push({ kind: "leak", x: p.x, y: p.y });
    this.sndQueue.push("leak");
  }

  private cullDead(): void {
    if (this.units.some((u) => u.dead)) this.units = this.units.filter((u) => !u.dead);
    if (this.projectiles.some((p) => p.dead)) this.projectiles = this.projectiles.filter((p) => !p.dead);
  }

  // ---- Wave flow (specs/flow.md) ----------------------------------------------
  private checkWaveEnd(): void {
    const w = this.activeWave;
    if (!w) return;
    if (this.spawnCursor >= w.events.length && this.units.length === 0) this.endWave();
  }

  private endWave(): void {
    this.score += SCORE_PER_WAVE * this.wave;
    this.charge += waveClearBonus(this.wave);
    this.activeWave = null;
    this.projectiles = [];
    if (this.wave >= this.diff.waves) {
      this.win();
      return;
    }
    // Open the next between-wave build phase.
    this.phase = "build";
    this.buildTimed = true;
    this.buildTimer = BUILD_PHASE_SECONDS;
    this.stampsUsed = 0; // the 5-stamp allowance refreshes at the start of the build phase
    this.charge += Math.min(INTEREST_CAP, Math.floor(this.charge * INTEREST_RATE)); // interest
    this.nextWave = buildWave(this.wave + 1, this.diff);
    for (const s of this.structures) s.refundable = false; // the full-refund window has closed
  }

  private beginWave(earlySeconds: number): void {
    if (earlySeconds > 0) this.charge += earlySeconds * EARLY_SEND_PER_SECOND;
    this.wave += 1;
    this.phase = "wave";
    this.paused = false;
    this.activeWave = this.nextWave;
    this.spawnCursor = 0;
    this.waveClock = 0;
    this.buildTimed = false;
    this.buildTimer = 0;
    this.nextWave = buildWave(Math.min(this.wave + 1, this.diff.waves), this.diff);
    for (const s of this.structures) s.refundable = false; // launching a wave closes the window
  }

  private win(): void {
    this.score += SCORE_PER_INTEGRITY * Math.max(0, this.integrity);
    this.state = "victory";
    this.units = [];
    this.projectiles = [];
  }

  private lose(): void {
    this.integrity = 0;
    this.state = "defeat";
    this.units = [];
    this.projectiles = [];
    this.activeWave = null;
  }

  // ---- The scrap-press build loop (specs/build.md) ----------------------------

  stampCost(): number {
    return STAMP_COST;
  }
  stampsLeft(): number {
    return Math.max(0, BUILDS_PER_LEVEL - this.stampsUsed);
  }
  canStamp(): boolean {
    return this.state === "playing" && this.held === null && this.stampsLeft() > 0 && this.charge >= STAMP_COST;
  }

  // Pull the press: spend 18 Charge + one stamp, roll a random type at a random quality on
  // the pinned odds, and HOLD it on the cursor (specs/build.md §6.2). Returns the roll, or
  // null if refused. Deterministic via the seeded press rng.
  pullPress(): HeldStamp | null {
    if (!this.canStamp()) return null;
    const roll = this.rollStamp();
    this.held = roll;
    this.sndQueue.push("stamp");
    return roll;
  }

  // Consume Charge + one stamp and roll a type/quality on the pinned independent odds.
  private rollStamp(): HeldStamp {
    this.charge -= STAMP_COST;
    this.stampsUsed += 1;
    return { type: this.rollType(), tier: this.rollTier() };
  }

  private rollType(): ComponentType {
    let r = this.press.next();
    for (const t of COMPONENT_ORDER) {
      r -= STAMP_TYPE_WEIGHT[t];
      if (r <= 0) return t;
    }
    return COMPONENT_ORDER[COMPONENT_ORDER.length - 1]!;
  }

  private rollTier(): Tier {
    let r = this.press.next();
    for (let tier = 1; tier <= MAX_TIER; tier++) {
      r -= STAMP_QUALITY_WEIGHT[tier]!;
      if (r <= 0) return tier as Tier;
    }
    return 1;
  }

  // Place the held stamp (or, if none is held, roll one now — the headless one-shot path) at
  // the 2×2 anchor (col, row) if legal; it lands ACTIVE and the floor re-paths live
  // (specs/build.md, specs/board.md). Fires a build-spark VFX. Returns the placed component,
  // or null (a rolled-but-refused stamp is retained on the cursor, so no roll is lost).
  placeStamp(col: number, row: number): Component | null {
    if (this.state !== "playing") return null;
    let stamp = this.held;
    if (!stamp) {
      if (!this.canStamp()) return null;
      stamp = this.rollStamp();
    }
    if (!this.board.canPlace(col, row, this.structures, this.units)) {
      this.held = stamp; // keep it on the cursor for a retry (the roll is already committed)
      return null;
    }
    const comp: Component = {
      id: this.nextId++,
      kind: "component",
      type: stamp.type,
      tier: stamp.tier,
      col,
      row,
      invested: investedValue(stamp.tier),
      placedForWave: this.phase === "build" ? this.wave + 1 : this.wave,
      refundable: this.phase === "build",
      targeting: "first",
      cooldown: 0,
      fireAnim: 999,
      aimAngle: 0,
    };
    this.structures.push(comp);
    this.held = null;
    this.selectedId = comp.id;
    this.rePath();
    const ctr = footprintCenter(col, row);
    this.fxQueue.push({ kind: "buildspark", x: ctr.x, y: ctr.y, tier: stamp.tier });
    this.sndQueue.push("stamp");
    return comp;
  }

  cancelHeld(): void {
    this.held = null; // the roll is committed (Charge already spent); the stamp is discarded
  }

  // ---- The three fates: keep / slag / combine (specs/build.md §6.6) ------------

  keep(id: number): void {
    // Keeping is the default fate — the component is already active and walling. This is a
    // confirm the headless harness may call; it only verifies the piece exists.
    void this.structures.find((s) => s.id === id && s.kind === "component");
  }

  // Slag an active component into an inert slag wall: it stops firing but keeps walling,
  // refunding a flat 12 Charge (specs/build.md §6.4). One-way; the footprint is unchanged.
  slag(id: number): void {
    const i = this.structures.findIndex((s) => s.id === id && s.kind === "component");
    if (i < 0) return;
    const c = this.structures[i] as Component;
    const wall: SlagWall = {
      id: c.id,
      kind: "slag",
      col: c.col,
      row: c.row,
      invested: c.invested,
      placedForWave: c.placedForWave,
      refundable: false, // a slag wall sells for a flat 6 (specs/flow.md); no full-refund
    };
    this.structures[i] = wall;
    this.charge += SLAG_REFUND;
    this.fxQueue.push({ kind: "buildspark", x: footprintCenter(c.col, c.row).x, y: footprintCenter(c.col, c.row).y });
    this.sndQueue.push("slag");
    // Firing stops but the footprint is unchanged, so no re-path is needed.
  }
  slagSelected(): void {
    const s = this.selected();
    if (s && s.kind === "component") this.slag(s.id);
  }
  slagValue(): number {
    return SLAG_REFUND;
  }

  // Does an active component of `c`'s exact type AND quality exist elsewhere on the board
  // (so COMBINE is offered)? Tesla-Prime is the apex and never combines (specs/build.md §6.5).
  canCombine(c: Component): boolean {
    return c.tier < MAX_TIER && this.combinePartnerOf(c) !== null;
  }
  combinePartnerOf(c: Component): Component | null {
    if (c.tier >= MAX_TIER) return null;
    for (const s of this.structures) {
      if (s.kind === "component" && s.id !== c.id && s.type === c.type && s.tier === c.tier) return s;
    }
    return null;
  }

  // Combine two matching components → one a tier higher at `id`'s footprint; consumes both,
  // frees the partner's footprint (re-pathing), costs no Charge (specs/build.md §6.5).
  combine(id: number): void {
    const c = this.structures.find((s) => s.id === id && s.kind === "component") as Component | undefined;
    if (!c || c.tier >= MAX_TIER) return;
    const partner = this.combinePartnerOf(c);
    if (!partner) return;
    this.structures = this.structures.filter((s) => s.id !== partner.id);
    c.tier = (c.tier + 1) as Tier;
    c.invested = c.invested + partner.invested; // sum of the two consumed → doubles each rung
    c.cooldown = 0;
    c.fireAnim = 0;
    if (this.selectedId === partner.id) this.selectedId = c.id;
    this.rePath(); // the partner footprint is freed
    const ctr = footprintCenter(c.col, c.row);
    this.fxQueue.push({ kind: "combine", x: ctr.x, y: ctr.y, tier: c.tier });
    this.sndQueue.push("combine");
  }
  combineSelected(): void {
    const s = this.selected();
    if (s && s.kind === "component" && this.canCombine(s)) this.combine(s.id);
  }

  // ---- Sell (specs/towers.md §5.6) --------------------------------------------

  sellValue(s: Structure): number {
    if (s.kind === "slag") return SLAG_WALL_SELL;
    return s.refundable ? s.invested : sellRefund(s.tier);
  }
  sell(id: number): void {
    const s = this.structures.find((x) => x.id === id);
    if (!s) return;
    this.charge += this.sellValue(s);
    this.structures = this.structures.filter((x) => x.id !== id);
    if (this.selectedId === id) this.selectedId = null;
    this.rePath(); // the footprint is freed
    this.sndQueue.push("slag");
  }
  sellSelected(): void {
    const s = this.selected();
    if (s) this.sell(s.id);
  }

  // ---- Targeting (specs/towers.md §5.2, specs/controls.md) --------------------

  setTargeting(c: Component, mode: TargetingMode): void {
    c.targeting = mode;
  }
  cycleTargeting(c: Component): void {
    const i = TARGETING_ORDER.indexOf(c.targeting);
    c.targeting = TARGETING_ORDER[(i + 1) % TARGETING_ORDER.length]!;
  }
  cycleTargetingSelected(): void {
    const s = this.selected();
    if (s && s.kind === "component") this.cycleTargeting(s);
  }

  // ---- Selection --------------------------------------------------------------

  select(id: number | null): void {
    this.selectedId = id;
  }
  selectAt(x: number, y: number): void {
    const s = this.structureAt(x, y);
    this.selectedId = s ? s.id : null;
  }
  structureAt(x: number, y: number): Structure | null {
    const t = this.board.pixelToTile(x, y);
    for (const s of this.structures) {
      if (t.col >= s.col && t.col <= s.col + 1 && t.row >= s.row && t.row <= s.row + 1) return s;
    }
    return null;
  }
  selected(): Structure | null {
    return this.selectedId != null ? (this.structures.find((s) => s.id === this.selectedId) ?? null) : null;
  }

  // ---- Wave control (specs/flow.md, specs/controls.md) ------------------------

  canStartWave(): boolean {
    return this.state === "playing" && this.phase === "build";
  }
  startWave(): void {
    if (!this.canStartWave()) return;
    const early = this.buildTimed ? Math.max(0, Math.floor(this.buildTimer)) : 0;
    this.beginWave(early);
  }
  currentWave(): Wave | null {
    return this.activeWave ?? this.nextWave;
  }
  nextWavePreview(): Wave {
    return this.nextWave;
  }
  waveProgress(): number {
    const w = this.activeWave;
    if (!w || w.events.length === 0) return 0;
    return Math.min(1, this.spawnCursor / w.events.length);
  }

  // ---- Speed / pause (specs/controls.md) --------------------------------------

  cycleSpeed(): void {
    this.speed = this.speed === 1 ? 2 : 1;
  }
  togglePause(): void {
    if (this.state === "playing") this.paused = !this.paused;
  }

  // ---- Queries ----------------------------------------------------------------

  statsOf(c: Component): CompStats {
    return deriveStats(c.type, c.tier);
  }

  // ---- Headless / dev helpers (drive the balance harness) ---------------------

  devGrant(charge: number, integrity: number): void {
    this.charge = charge;
    this.integrity = integrity;
    this.maxIntegrity = Math.max(this.maxIntegrity, integrity);
  }
  devBeginWave(n: number): void {
    this.wave = n - 1;
    this.phase = "build";
    this.buildTimed = false;
    this.nextWave = buildWave(n, this.diff);
    this.startWave();
  }

  // Place a component of an EXACT type + quality at (or nearest-legal to) an anchor, with no
  // press roll and no Charge cost, landing ACTIVE with a live re-path (specs/build.md). The
  // deterministic counterpart to the random scrap-press, used by the headless balance harness
  // and the proof-capture script to lay out a named board; the interactive build path stays
  // the random press + placeStamp. Returns the placed component, or null if nowhere is legal.
  devPlace(type: ComponentType, tier: Tier, col: number, row: number): Component | null {
    const anchor = this.board.nearestLegalAnchor(col, row, this.structures, this.units);
    if (!anchor) return null;
    const comp: Component = {
      id: this.nextId++,
      kind: "component",
      type,
      tier,
      col: anchor.col,
      row: anchor.row,
      invested: investedValue(tier),
      placedForWave: this.phase === "build" ? this.wave + 1 : this.wave,
      refundable: this.phase === "build",
      targeting: "first",
      cooldown: 0,
      fireAnim: 999,
      aimAngle: 0,
    };
    this.structures.push(comp);
    this.selectedId = comp.id;
    this.rePath();
    return comp;
  }
}
