// Arc Foundry — the simulation (specs/board.md, specs/towers.md, specs/build.md,
// specs/flow.md).
//
// A fixed-step model of the Load mazing the ordered-waypoint chain around the walls, the
// GemTD scrap-press build (place a rock that rolls a random component ON PLACEMENT, KEEP
// exactly one a level, the rest harden into inert blockers), the combine quality ladder and
// the UPGRADE QUALITY refinement track, five components firing automatically with travelling
// projectiles / arcs, the economy and Grid Integrity, and the wave campaign with its Dynamo
// boss. The simulation is DOM-free and its control API is INPUT-FREE and DETERMINISTIC — no
// pointer, no clock, no rng from the wall — so the browser and the headless balance harness
// drive it identically: a fixed seed + a fixedStep(dt) loop reproduces a match exactly.
// Rendering, audio, and particles read this state and drain its fx/sound queues each frame.

import {
  BUILDS_PER_LEVEL,
  COMPONENT_ORDER,
  DEFAULT_MAP,
  DIFFICULTY,
  INTEREST_CAP,
  INTEREST_RATE,
  LOAD,
  MAX_TIER,
  PROJECTILE_SPEED,
  QUALITY_ODDS_BY_R,
  SCORE_PER_INTEGRITY,
  SCORE_PER_WAVE,
  STAMP_COST,
  STAMP_TYPE_WEIGHT,
  TARGETING_ORDER,
  deriveStats,
  footprintCenter,
  nextRefineCost,
  scaledHp,
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
  Blocker,
  Candidate,
  Component,
  ComponentType,
  Cue,
  FxEvent,
  GameState,
  Harvest,
  MapDef,
  Phase,
  Projectile,
  Refinement,
  Structure,
  TargetingMode,
  Tier,
  Unit,
} from "./types";
import { Rng } from "./rng";

// The seed for the scrap-press roll. Fixed so a given sequence of placements reproduces
// exactly; the wave composition seeds itself per wave (waves.ts).
const PRESS_SEED = 0x51a6c0de;

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
  structures: Structure[] = []; // components, candidates, and blockers — the maze (specs/board.md)

  // The scrap-press seed. Fixed by default so the headless balance harness and any dev
  // driver reproduce exactly; the interactive build (main.ts) reseeds it to a fresh random
  // value each run so real playthroughs draw a different roll sequence.
  pressSeed = PRESS_SEED;

  // Build / selection UI state.
  holding = false; // a blank rock is on the cursor (rolls on placement, specs/build.md)
  selectedId: number | null = null;
  stampsUsed = 0; // rocks placed of the level's BUILDS_PER_LEVEL allowance (decrements on PLACEMENT)
  refinement: Refinement = 0; // UPGRADE QUALITY level (biases the quality roll, specs/build.md)
  harvest: Harvest = { mode: "none" }; // the level's single keep/combine choice, resolved at SEND
  pointerX = -1; // logical-space pointer, for the held-rock ghost / range preview
  pointerY = -1;

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
    this.press = new Rng(this.pressSeed);
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
    this.holding = false;
    this.selectedId = null;
    this.stampsUsed = 0;
    this.refinement = 0;
    this.harvest = { mode: "none" };
    this.pointerX = -1;
    this.pointerY = -1;
    this.kills = 0;
    this.leakCount = 0;
    this.fxQueue = [];
    this.sndQueue = [];
    this.activeWave = null;
    this.spawnCursor = 0;
    this.waveClock = 0;
    this.nextId = 1;
    this.press = new Rng(this.pressSeed);
    this.nextWave = buildWave(1, this.diff);
    this.occ = this.board.occupancy(this.structures);
  }

  // Reseed the scrap-press so the roll sequence differs (specs/build.md). The interactive
  // build calls this once per run with a fresh random seed so no two playthroughs draw the
  // same components; the harness and proof leave the fixed default for reproducibility.
  reseedPress(seed: number): void {
    this.pressSeed = seed >>> 0;
    this.press = new Rng(this.pressSeed);
  }

  // ---- Fixed simulation step (specs/controls.md) ------------------------------
  fixedStep(dt: number): void {
    if (this.state !== "playing" || this.paused) return;

    if (this.phase === "build") {
      // Build phases are UNTIMED (specs/flow.md): nothing starts the wave but SEND. Advance
      // component firing animations cosmetically; no units are on the floor to fire at.
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

  // ---- Re-path (specs/board.md) -----------------------------------------------
  // Rebuild the cached occupancy and re-route every walking unit from where it stands —
  // called whenever the maze changes (a rock placed, a combine freeing a footprint).
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
      sourceId: c.id,
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
  // The damage and any kill are attributed back to the firing component for its inspector
  // tally (specs/towers.md) via the projectile's sourceId.
  private hit(pr: Projectile, u: Unit, dmg: number): void {
    if (u.dead || pr.hitIds.includes(u.id)) return;
    pr.hitIds.push(u.id);
    const applied = Math.min(dmg, Math.max(0, u.hp)); // count only damage that lands, not overkill
    u.hp -= dmg;
    u.hitFlash = 0;
    const src = this.componentById(pr.sourceId);
    if (src) src.damageDealt += applied;
    if (u.hp <= 0) {
      if (src) src.kills += 1;
      this.kill(u);
    }
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

  private componentById(id: number): Component | null {
    for (const s of this.structures) if (s.id === id && s.kind === "component") return s;
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
    // Open the next (untimed) between-wave build phase; refresh the allowance and pay interest.
    this.phase = "build";
    this.stampsUsed = 0; // the 5-stamp allowance refreshes at the start of the build phase
    this.harvest = { mode: "none" };
    this.holding = false;
    this.charge += Math.min(INTEREST_CAP, Math.floor(this.charge * INTEREST_RATE)); // interest
    this.nextWave = buildWave(this.wave + 1, this.diff);
  }

  // Resolve the level's harvest (keep / combine) and start the wave (specs/build.md,
  // specs/flow.md). The kept candidate becomes a firing component; every un-harvested
  // candidate hardens into a blocker.
  private beginWave(): void {
    this.resolveHarvest();
    this.wave += 1;
    this.phase = "wave";
    this.paused = false;
    this.holding = false;
    this.activeWave = this.nextWave;
    this.spawnCursor = 0;
    this.waveClock = 0;
    this.occ = this.board.occupancy(this.structures);
    this.nextWave = buildWave(Math.min(this.wave + 1, this.diff.waves), this.diff);
  }

  // Turn this level's single keep/combine choice into the one new/upgraded component, and
  // harden every remaining candidate into an inert blocker (specs/build.md).
  private resolveHarvest(): void {
    const h = this.harvest;
    if (h.mode === "keep") {
      const cand = this.candidateById(h.id);
      if (cand) this.promoteToComponent(cand);
    } else if (h.mode === "combine") {
      this.resolveCombine(h.id, h.partnerId);
    }
    // Every leftover candidate becomes a blocker.
    let hardened = false;
    for (let i = 0; i < this.structures.length; i++) {
      const s = this.structures[i]!;
      if (s.kind === "candidate") {
        this.structures[i] = { id: s.id, kind: "blocker", col: s.col, row: s.row } as Blocker;
        hardened = true;
      }
    }
    if (hardened) this.sndQueue.push("settle");
    this.harvest = { mode: "none" };
  }

  // Replace a candidate in place with a firing component of its rolled type + tier.
  private promoteToComponent(cand: Candidate): void {
    const i = this.structures.findIndex((s) => s.id === cand.id);
    if (i < 0) return;
    const comp: Component = {
      id: cand.id,
      kind: "component",
      type: cand.type,
      tier: cand.tier,
      col: cand.col,
      row: cand.row,
      targeting: "first",
      cooldown: 0,
      fireAnim: 999,
      aimAngle: 0,
      kills: 0,
      damageDealt: 0,
    };
    this.structures[i] = comp;
    const ctr = footprintCenter(comp.col, comp.row);
    this.fxQueue.push({ kind: "combine", x: ctr.x, y: ctr.y, tier: comp.tier });
  }

  // Resolve a combine harvest: the candidate `id` and its `partnerId` (another candidate or an
  // existing component of the same type + tier) fold into one a tier higher at the candidate's
  // footprint; the partner is consumed but its footprint HARDENS INTO A BLOCKER so the maze wall
  // is preserved (specs/build.md — a combine never opens a hole).
  private resolveCombine(id: number, partnerId: number): void {
    const cand = this.candidateById(id);
    const partner = this.structures.find((s) => s.id === partnerId) as Candidate | Component | undefined;
    if (!cand || !partner || cand.tier >= MAX_TIER || partner.type !== cand.type || partner.tier !== cand.tier) {
      // Fall back to a plain keep if the pairing is no longer valid.
      if (cand) this.promoteToComponent(cand);
      return;
    }
    const newTier = (cand.tier + 1) as Tier;
    // The partner is consumed INTO the higher-tier component, but its 2×2 footprint must stay a
    // WALL: replace it IN PLACE with an inert blocker rather than freeing its tiles, so a combine
    // never opens a hole in the maze (specs/build.md). This matches the balance harness's
    // mergeDuplicate, which re-hardens the consumed footprint into a blocker. The riser lands on
    // the candidate's footprint.
    const pIdx = this.structures.findIndex((s) => s.id === partner.id);
    if (pIdx >= 0) {
      this.structures[pIdx] = { id: partner.id, kind: "blocker", col: partner.col, row: partner.row } as Blocker;
    }
    const i = this.structures.findIndex((s) => s.id === cand.id);
    const comp: Component = {
      id: cand.id,
      kind: "component",
      type: cand.type,
      tier: newTier,
      col: cand.col,
      row: cand.row,
      targeting: "first",
      cooldown: 0,
      fireAnim: 999,
      aimAngle: 0,
      kills: 0,
      damageDealt: 0,
    };
    if (i >= 0) this.structures[i] = comp;
    else this.structures.push(comp);
    const ctr = footprintCenter(comp.col, comp.row);
    this.fxQueue.push({ kind: "combine", x: ctr.x, y: ctr.y, tier: comp.tier });
    this.sndQueue.push("combine");
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
  // The press may be pulled only in the BUILD phase, with a stamp of the level's 5-allowance
  // left and enough Charge — the cap is five regardless of how much Charge you hold.
  canStamp(): boolean {
    return (
      this.state === "playing" &&
      this.phase === "build" &&
      !this.holding &&
      this.stampsLeft() > 0 &&
      this.charge >= STAMP_COST
    );
  }

  // Pull the press: arm a BLANK rock on the cursor (specs/build.md). No roll and no Charge
  // yet — the roll and cost happen when the rock lands (placeStamp). Returns true if armed.
  pullPress(): boolean {
    if (!this.canStamp()) return false;
    this.holding = true;
    this.sndQueue.push("stamp");
    return true;
  }

  private rollType(): ComponentType {
    let r = this.press.next();
    for (const t of COMPONENT_ORDER) {
      r -= STAMP_TYPE_WEIGHT[t];
      if (r <= 0) return t;
    }
    return COMPONENT_ORDER[COMPONENT_ORDER.length - 1]!;
  }

  // Quality roll biased by the current Refinement level (specs/build.md — UPGRADE QUALITY).
  private rollTier(): Tier {
    const odds = QUALITY_ODDS_BY_R[this.refinement]!;
    let r = this.press.next();
    for (let tier = 1; tier <= MAX_TIER; tier++) {
      r -= odds[tier - 1]!;
      if (r <= 0) return tier as Tier;
    }
    return 1;
  }

  // Is the 2×2 anchor (col, row) exactly an existing blocker's footprint? Dropping a rock onto
  // a blocker rerolls it into a fresh candidate (specs/build.md).
  private blockerAtAnchor(col: number, row: number): Blocker | null {
    for (const s of this.structures) {
      if (s.kind === "blocker" && s.col === col && s.row === row) return s;
    }
    return null;
  }

  // Where a rock may land: an empty legal footprint, OR exactly onto an existing blocker
  // (which it rerolls). specs/build.md, specs/board.md.
  canPlaceAt(col: number, row: number): boolean {
    if (this.state !== "playing" || this.phase !== "build") return false;
    if (this.blockerAtAnchor(col, row)) return true;
    return this.board.canPlace(col, row, this.structures, this.units);
  }

  // Drop a rock at the 2×2 anchor (col, row): the roll happens HERE (a random type + quality
  // on the current Refinement odds), spending 10 Charge + one stamp and landing a CANDIDATE
  // that walls and re-paths the floor (specs/build.md, specs/board.md). Dropping onto a
  // blocker rerolls it in place. Returns the placed candidate, or null if refused (no cost).
  // Re-arms another rock afterward if the allowance + Charge still permit (continuous
  // placement). If no rock is held (the headless one-shot path), it arms one implicitly.
  placeStamp(col: number, row: number): Candidate | null {
    if (this.state !== "playing" || this.phase !== "build") return null;
    if (!this.holding && !this.canStamp()) return null;
    // Not enough Charge / no allowance and not currently holding: refuse.
    if (this.stampsLeft() <= 0 || this.charge < STAMP_COST) return null;
    const onBlocker = this.blockerAtAnchor(col, row);
    if (!onBlocker && !this.board.canPlace(col, row, this.structures, this.units)) {
      return null; // illegal spot: keep holding, nothing spent
    }
    if (onBlocker) {
      // Reroll a blocker in place: remove it, drop a candidate on the same footprint.
      this.structures = this.structures.filter((s) => s.id !== onBlocker.id);
    }
    this.charge -= STAMP_COST;
    this.stampsUsed += 1;
    const cand: Candidate = {
      id: this.nextId++,
      kind: "candidate",
      type: this.rollType(),
      tier: this.rollTier(),
      col,
      row,
    };
    this.structures.push(cand);
    this.selectedId = cand.id;
    // Continuous placement (specs/build.md): release the placed rock, then immediately re-arm
    // another if the allowance + Charge still permit. canStamp() requires !holding, so holding
    // MUST be cleared first — otherwise it always reads false and the hand empties after one drop.
    this.holding = false;
    this.holding = this.canStamp();
    this.rePath();
    const ctr = footprintCenter(col, row);
    this.fxQueue.push({ kind: "buildspark", x: ctr.x, y: ctr.y, tier: cand.tier });
    this.sndQueue.push("stamp");
    return cand;
  }

  cancelHeld(): void {
    this.holding = false; // nothing was rolled or spent — cancelling a held rock is free
  }

  // ---- Dismantle — remove a misplaced structure between waves (specs/build.md) --
  // A correction tool, BUILD-PHASE only: clears a component, candidate, or blocker's 2×2
  // footprint and re-paths live. It NEVER refunds the stamp or Charge — a refund would let a
  // player place a rock, reject its roll, dismantle it, and re-roll indefinitely, defeating the
  // scrap-press RNG. A dismantle only ever OPENS routes, so it can never seal a segment.
  canRemove(id: number): boolean {
    if (this.state !== "playing" || this.phase !== "build") return false;
    return this.structures.some((s) => s.id === id);
  }
  removeStructure(id: number): boolean {
    if (this.state !== "playing" || this.phase !== "build") return false;
    const i = this.structures.findIndex((s) => s.id === id);
    if (i < 0) return false;
    const s = this.structures[i]!;
    if (s.kind === "candidate") {
      // No stamp/Charge refund — the roll is spent for good. Only drop the level's harvest if
      // it referenced this candidate (as the keep or the combine partner).
      const h = this.harvest;
      if (h.mode !== "none" && (h.id === id || (h.mode === "combine" && h.partnerId === id))) {
        this.harvest = { mode: "none" };
      }
    }
    this.structures.splice(i, 1);
    if (this.selectedId === id) this.selectedId = null;
    this.rePath();
    this.sndQueue.push("settle"); // a rock-settle thunk for the dismantle
    return true;
  }
  removeSelected(): void {
    if (this.selectedId != null) this.removeStructure(this.selectedId);
  }

  // ---- Keep / combine — the one harvest per level (specs/build.md) -------------

  candidateById(id: number): Candidate | null {
    const s = this.structures.find((x) => x.id === id);
    return s && s.kind === "candidate" ? s : null;
  }
  candidates(): Candidate[] {
    return this.structures.filter((s): s is Candidate => s.kind === "candidate");
  }
  // The candidate that will become this level's kept component (keep or combine), or null.
  keptId(): number | null {
    return this.harvest.mode === "none" ? null : this.harvest.id;
  }

  // Mark a candidate as this level's kept roll (reversible until SEND). Only one at a time.
  keep(id: number): void {
    if (this.phase !== "build") return;
    if (!this.candidateById(id)) return;
    this.harvest = { mode: "keep", id };
  }
  keepSelected(): void {
    const s = this.selected();
    if (s && s.kind === "candidate") this.keep(s.id);
  }

  // Does a same-type + same-quality match exist for this candidate (another candidate or an
  // existing component), so COMBINE is offered? Tesla-Prime never combines (specs/build.md).
  canCombine(c: Candidate): boolean {
    return c.tier < MAX_TIER && this.combinePartnerOf(c) !== null;
  }
  combinePartnerOf(c: Candidate): Candidate | Component | null {
    if (c.tier >= MAX_TIER) return null;
    for (const s of this.structures) {
      if (s.id === c.id) continue;
      if ((s.kind === "candidate" || s.kind === "component") && s.type === c.type && s.tier === c.tier) return s;
    }
    return null;
  }

  // Set this level's harvest to a combine of candidate `id` with a matching partner (resolved
  // at SEND, producing one component a tier higher and consuming the partner). Build phase only.
  combine(id: number): void {
    if (this.phase !== "build") return;
    const c = this.candidateById(id);
    if (!c) return;
    const partner = this.combinePartnerOf(c);
    if (!partner) return;
    this.harvest = { mode: "combine", id, partnerId: partner.id };
  }
  combineSelected(): void {
    const s = this.selected();
    if (s && s.kind === "candidate" && this.canCombine(s)) this.combine(s.id);
  }

  // ---- UPGRADE QUALITY — the Refinement track (specs/build.md) -----------------

  refineCost(): number | null {
    return nextRefineCost(this.refinement);
  }
  canUpgradeQuality(): boolean {
    const cost = this.refineCost();
    return this.state === "playing" && this.phase === "build" && cost !== null && this.charge >= cost;
  }
  upgradeQuality(): boolean {
    const cost = this.refineCost();
    if (!this.canUpgradeQuality() || cost === null) return false;
    this.charge -= cost;
    this.refinement = (this.refinement + 1) as Refinement;
    this.sndQueue.push("combine"); // a bright confirm cue for the refinement
    return true;
  }

  // ---- Targeting (specs/towers.md, specs/controls.md) -------------------------

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
    this.holding = false;
    this.beginWave();
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
    this.harvest = { mode: "none" };
    this.nextWave = buildWave(n, this.diff);
    this.startWave();
  }
  devSetRefinement(r: Refinement): void {
    this.refinement = r;
  }
  // Drop a blocker (an inert wall) of no type at (or nearest-legal to) an anchor, with no
  // Charge cost — the deterministic maze-building counterpart used by the balance harness.
  devBlocker(col: number, row: number): Blocker | null {
    const anchor = this.board.nearestLegalAnchor(col, row, this.structures, this.units);
    if (!anchor) return null;
    const b: Blocker = { id: this.nextId++, kind: "blocker", col: anchor.col, row: anchor.row };
    this.structures.push(b);
    this.rePath();
    return b;
  }

  // Place a component of an EXACT type + quality at (or nearest-legal to) an anchor, with no
  // press roll and no Charge cost, landing ACTIVE with a live re-path (specs/build.md). The
  // deterministic counterpart to the random scrap-press, used by the headless balance harness
  // and dev drivers to lay out a named board; the interactive build path stays the random
  // press + placeStamp. Returns the placed component, or null if nowhere is legal.
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
      targeting: "first",
      cooldown: 0,
      fireAnim: 999,
      aimAngle: 0,
      kills: 0,
      damageDealt: 0,
    };
    this.structures.push(comp);
    this.selectedId = comp.id;
    this.rePath();
    return comp;
  }

  // Drop a CANDIDATE of an EXACT type + quality at (or nearest-legal to) an anchor, with no
  // press roll and no Charge cost — the deterministic counterpart used by a dev driver to
  // demonstrate keep / combine without depending on a random roll. Build phase only.
  devCandidate(type: ComponentType, tier: Tier, col: number, row: number): Candidate | null {
    if (this.phase !== "build") return null;
    const anchor = this.board.nearestLegalAnchor(col, row, this.structures, this.units);
    if (!anchor) return null;
    const cand: Candidate = { id: this.nextId++, kind: "candidate", type, tier, col: anchor.col, row: anchor.row };
    this.structures.push(cand);
    this.selectedId = cand.id;
    this.rePath();
    return cand;
  }
}
