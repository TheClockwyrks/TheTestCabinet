// Arc Foundry — the simulation (specs/board.md, specs/towers.md, specs/build.md,
// specs/flow.md).
//
// A fixed-step model of the Load mazing the ordered-waypoint chain around the walls, the
// GemTD scrap-press build (place a rock that rolls a random component ON PLACEMENT, KEEP
// exactly one a level, the rest harden into inert blockers), the combine quality ladder and
// the UPGRADE QUALITY refinement track, eight base component types plus assembled combination
// towers firing automatically with travelling
// projectiles / arcs, the economy and Grid Integrity, and the wave campaign with its Dynamo
// boss. The simulation is DOM-free and its control API is INPUT-FREE and DETERMINISTIC — no
// pointer, no clock, no rng from the wall — so the browser and the headless balance harness
// drive it identically: a fixed seed + a fixedStep(dt) loop reproduces a match exactly.
// Rendering, audio, and particles read this state and drain its fx/sound queues each frame.

import {
  AURA_BONUS_CAP,
  BUILDS_PER_LEVEL,
  COMBOS,
  COMBO_ORDER,
  COMBO_PROJECTILE_SPEED,
  COMPONENT_ORDER,
  DEFAULT_MAP,
  DIFFICULTY,
  LOAD,
  MAX_COMBO_LEVEL,
  MAX_TIER,
  PROJECTILE_SPEED,
  QUALITY_ODDS_BY_R,
  STAMP_TYPE_WEIGHT,
  TARGETING_ORDER,
  TILE,
  comboStats,
  comboUpgradeCost,
  deriveStats,
  footprintCenter,
  nextRefineCost,
  recipeKey,
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
  ComboType,
  Component,
  ComponentType,
  Cue,
  FxEvent,
  GameState,
  Harvest,
  MapDef,
  Phase,
  Projectile,
  Pt,
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

// The seed for the COMBAT rng — crit rolls (specs/towers.md). Separate from the press so
// build rolls and combat randomness are independent and each stays deterministic.
const COMBAT_SEED = 0x2f9d3b17;

// The post-final Overload Dynamo's walk speed (logical px/s). Brisk enough that the finale is a
// short, dramatic single pass — not the slow 30 px/s campaign Dynamo — while still long enough
// that a longer maze racks up a clearly higher Maze Rating (specs/enemies.md, specs/flow.md).
const FINALE_SPEED = 90;

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
  // The run keeps NO running score (specs/flow.md). Its one end-of-run number is the MAZE
  // RATING: total damage dealt to the post-final invincible Overload Dynamo. It accrues only
  // during the finale; a defeat never reaches it (0). Integrity only gates win/lose.
  mazeRating = 0;
  finale = false; // the post-final Overload Dynamo is walking the maze (specs/enemies.md)
  wave = 0; // 0 before Wave 1 (the untimed opening build phase)
  speed: 1 | 2 | 4 | 8 = 1;

  units: Unit[] = [];
  projectiles: Projectile[] = []; // shots / arcs in flight (specs/towers.md)
  structures: Structure[] = []; // components, candidates, and blockers — the maze (specs/board.md)

  // The scrap-press seed. Fixed by default so the headless balance harness and any dev
  // driver reproduce exactly; the interactive build (main.ts) reseeds it to a fresh random
  // value each run so real playthroughs draw a different roll sequence.
  pressSeed = PRESS_SEED;

  // Build / selection UI state.
  holding = false; // a blank rock is on the cursor (rolls on placement, specs/build.md)
  selectedId: number | null = null; // the PRIMARY selection (drives the inspector + range ring)
  // Additional multi-selected structure ids (excluding the primary), for EXPLICIT combining:
  // the player shift-clicks the exact copies to fold, and the combine set is [selectedId,
  // ...selectedIds] (specs/controls.md, specs/build.md). Empty for a plain single selection.
  selectedIds: number[] = [];
  stampsUsed = 0; // rocks placed of the level's BUILDS_PER_LEVEL allowance (decrements on PLACEMENT)
  refinement: Refinement = 0; // UPGRADE QUALITY level (biases the quality roll, specs/build.md)
  harvest: Harvest = { mode: "none" }; // transient: the level's keep/combine, resolved as it launches the wave
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
  private simTime = 0; // seconds of live-wave sim elapsed this run (drives status-effect timers)
  private nextId = 1;
  private press: Rng;
  private combat: Rng; // crit rolls (specs/towers.md) — deterministic, separate from the press
  private occ: Occupancy; // cached occupancy of the current structures + housings
  // Cached ground maze route + its length in tiles (the HUD readout + hover overlay). The
  // route only changes when the walls do, so it is recomputed lazily and invalidated on any
  // structure change (specs/board.md — the Load takes the shortest OPEN route). Null = dirty.
  private mazeCache: { path: Pt[]; lenTiles: number } | null = null;

  constructor(campaign: Campaign, map: MapDef = DEFAULT_MAP, diff: DifficultyDef = DIFFICULTY.medium) {
    this.campaign = campaign;
    this.map = map;
    this.diff = diff;
    this.board = new Board(map);
    this.press = new Rng(this.pressSeed);
    this.combat = new Rng(COMBAT_SEED);
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
    this.mazeRating = 0;
    this.finale = false;
    this.wave = 0;
    this.speed = 1;
    this.units = [];
    this.projectiles = [];
    this.structures = [];
    this.holding = false;
    this.selectedId = null;
    this.selectedIds = [];
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
    this.simTime = 0;
    this.nextId = 1;
    this.press = new Rng(this.pressSeed);
    this.combat = new Rng(COMBAT_SEED);
    this.nextWave = buildWave(1, this.diff);
    this.occ = this.board.occupancy(this.structures);
    this.mazeCache = null;
  }

  // Reseed the scrap-press so the roll sequence differs (specs/build.md). The interactive
  // build calls this once per run with a fresh random seed so no two playthroughs draw the
  // same components; the harness and proof leave the fixed default for reproducibility.
  reseedPress(seed: number): void {
    this.pressSeed = seed >>> 0;
    this.press = new Rng(this.pressSeed);
    this.combat = new Rng((seed ^ 0x9e3779b9) >>> 0); // vary crit rolls per interactive run too
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
    this.simTime += dt;
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
    const hp = scaledHp(def.baseHp, this.wave, this.diff);
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
      slowFactor: 1,
      slowUntil: 0,
      burnDps: 0,
      burnUntil: 0,
      burnSourceId: 0,
      invincible: false,
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
    this.mazeCache = null; // the walls moved — the maze readout / overlay must recompute
    for (const u of this.units) {
      if (u.dead) continue;
      u.route = this.board.routeFor({ x: u.x, y: u.y }, u.wpIndex, this.occ, u.flies);
      u.routeStep = 0;
    }
    this.recomputeAuras();
  }

  // ---- Aura (specs/towers.md) -------------------------------------------------
  // A Regulator (and some combination towers) projects a passive damage aura. Cache each
  // firing tower's total external aura bonus (sum of every aura source whose radius covers
  // its center, capped) so firing reads it cheaply. Recomputed whenever the maze changes and
  // at wave start. A tower does not buff itself.
  private recomputeAuras(): void {
    // Collect aura sources: any component whose OWN stats carry an aura radius.
    const sources: { x: number; y: number; r2: number; bonus: number; id: number }[] = [];
    for (const s of this.structures) {
      if (s.kind !== "component") continue;
      const st = this.baseStatsOf(s);
      if (st.auraRadius > 0 && st.auraBonus > 0) {
        const ctr = footprintCenter(s.col, s.row);
        sources.push({ x: ctr.x, y: ctr.y, r2: st.auraRadius * st.auraRadius, bonus: st.auraBonus, id: s.id });
      }
    }
    for (const s of this.structures) {
      if (s.kind !== "component") continue;
      if (!this.baseStatsOf(s).fires) {
        s.auraBonus = 0;
        continue;
      }
      const ctr = footprintCenter(s.col, s.row);
      let sum = 0;
      for (const src of sources) {
        if (src.id === s.id) continue; // no self-buff
        const dx = ctr.x - src.x;
        const dy = ctr.y - src.y;
        if (dx * dx + dy * dy <= src.r2) sum += src.bonus;
      }
      s.auraBonus = Math.min(AURA_BONUS_CAP, sum);
    }
  }

  // A component's UNBUFFED effective stats: a combination tower's fixed block, or a base
  // component's (type, tier) derivation. Aura is applied on top by statsOf().
  private baseStatsOf(c: Component): CompStats {
    return c.combo ? comboStats(c.combo, c.comboLevel) : deriveStats(c.type, c.tier);
  }

  // ---- Component fire (specs/towers.md) ---------------------------------------
  private stepComponents(dt: number): void {
    for (const s of this.structures) {
      if (s.kind !== "component") continue;
      const c = s;
      c.fireAnim += dt;
      const stats = this.statsOf(c);
      if (!stats.fires) continue; // Regulator (and any non-firing node): aura only
      const center = footprintCenter(c.col, c.row);
      const targets = this.pickTargets(c, stats, center);
      if (targets.length > 0) c.aimAngle = Math.atan2(targets[0]!.y - center.y, targets[0]!.x - center.x);
      c.cooldown -= dt;
      if (c.cooldown > 0 || targets.length === 0) continue;
      c.cooldown = 1 / stats.fireRate;
      c.fireAnim = 0;
      // A shot per target (multishot fires at up to `stats.multishot` distinct units at once).
      for (const t of targets) this.launchProjectile(c, stats, center, t);
      this.fireCue(c, stats);
    }
  }

  // The valid in-range units this component fires at this cadence, under its targeting
  // priority: one for a single-target tower, up to `stats.multishot` distinct units for a
  // multishot combo (each gets its own projectile).
  private pickTargets(c: Component, stats: CompStats, center: { x: number; y: number }): Unit[] {
    const r2 = stats.range * stats.range;
    const inRange: Unit[] = [];
    for (const u of this.units) {
      if (u.dead) continue;
      const dx = u.x - center.x;
      const dy = u.y - center.y;
      if (dx * dx + dy * dy <= r2) inRange.push(u);
    }
    if (inRange.length === 0) return [];
    const n = Math.max(1, stats.multishot);
    if (n === 1) {
      let best = inRange[0]!;
      for (let i = 1; i < inRange.length; i++) if (this.better(c.targeting, inRange[i]!, best, center)) best = inRange[i]!;
      return [best];
    }
    // Stable sort by priority (JS sort is stable → ties keep spawn order, deterministic).
    inRange.sort((a, b) => (this.better(c.targeting, a, b, center) ? -1 : this.better(c.targeting, b, a, center) ? 1 : 0));
    return inRange.slice(0, n);
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
    // Crit (combo-only): roll off the deterministic combat rng; a crit multiplies the shot.
    const isCrit = stats.critChance > 0 && this.combat.next() < stats.critChance;
    const dmg = isCrit ? Math.round(stats.dmg * stats.critMult) : stats.dmg;
    this.projectiles.push({
      id: this.nextId++,
      sourceId: c.id,
      type: c.type,
      tier: c.tier,
      combo: c.combo,
      dmg,
      x: mx,
      y: my,
      angle: c.aimAngle,
      speed: c.combo ? COMBO_PROJECTILE_SPEED : PROJECTILE_SPEED[c.type],
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
    // Muzzle glow at the head, plus the travelling bolt/spray FX for a single-bolt shot. A
    // chain (Coil) draws its arcs at impact and a splash (Arc-Node) its ring at impact, so
    // those emit no travelling-bolt FX here (specs/assets.md).
    this.fxQueue.push({ kind: "muzzle", x: mx, y: my, tier: c.tier });
    if (stats.chainLeaps === 0 && stats.splash === 0) {
      const spray = c.type === "emitter" && !c.combo;
      const big = !spray && (c.type === "discharge" || stats.dmg >= 120);
      this.fxQueue.push({ kind: spray ? "spray" : "arcbolt", x: mx, y: my, x2: target.x, y2: target.y, tier: c.tier, big });
    }
  }

  // One sound cue per volley, keyed on the tower's firing signature (specs/assets.md).
  private fireCue(c: Component, stats: CompStats): void {
    if (stats.chainLeaps > 0) this.sndQueue.push("chain");
    else if (stats.splash > 0) this.sndQueue.push("discharge");
    else if (c.type === "discharge" || stats.dmg >= 120) this.sndQueue.push("discharge");
    else if (c.type === "choke" && !c.combo) this.sndQueue.push("slow");
    else if (c.type === "rectifier" && !c.combo) this.sndQueue.push("burn");
    else this.sndQueue.push("zap");
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
    this.fxQueue.push({ kind: "impact", x: pr.x, y: pr.y, tier: pr.tier, big: pr.isCrit });

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
    u.hitFlash = 0;
    // The post-final Overload Dynamo cannot die: every shot's FULL damage is tallied into the
    // Maze Rating (specs/enemies.md, specs/flow.md), and it still takes slow/burn so a maze that
    // controls it keeps it under fire longer — but its HP never falls and it is never killed.
    if (u.invincible) {
      this.tallyRating(dmg, pr.sourceId);
      if (pr.slowAmt > 0) this.applySlow(u, pr.slowAmt, pr.slowDur);
      if (pr.burnFrac > 0) this.applyBurn(u, pr.dmg * pr.burnFrac, pr.burnDur, pr.sourceId);
      return;
    }
    const applied = Math.min(dmg, Math.max(0, u.hp)); // count only damage that lands, not overkill
    u.hp -= dmg;
    const src = this.componentById(pr.sourceId);
    if (src) src.damageDealt += applied;
    if (u.hp <= 0) {
      if (src) src.kills += 1;
      this.kill(u);
      return;
    }
    // The unit survived: apply the shot's status effects (specs/towers.md). A burn's DoT is a
    // fraction of the primary shot's damage, and attributes its ticks back to the firing tower.
    if (pr.slowAmt > 0) this.applySlow(u, pr.slowAmt, pr.slowDur);
    if (pr.burnFrac > 0) this.applyBurn(u, pr.dmg * pr.burnFrac, pr.burnDur, pr.sourceId);
  }

  // Credit damage dealt to the invincible finale boss: it adds to the run's MAZE RATING and to
  // the firing component's DMG-dealt tally (so the DMG board still ranks towers), and never
  // touches HP or a kill (specs/flow.md).
  private tallyRating(dmg: number, srcId: number): void {
    this.mazeRating += dmg;
    const src = this.componentById(srcId);
    if (src) src.damageDealt += dmg;
  }

  // Slow (specs/towers.md): a unit's effective speed becomes base × slowFactor while active.
  // The strongest active slow wins; each hit refreshes the duration.
  private applySlow(u: Unit, amt: number, dur: number): void {
    const activeFactor = this.simTime < u.slowUntil ? u.slowFactor : 1;
    u.slowFactor = Math.min(activeFactor, 1 - amt);
    u.slowUntil = this.simTime + dur;
    this.fxQueue.push({ kind: "slowhit", x: u.x, y: u.y });
  }

  // Burn (specs/towers.md): an overcurrent DoT ticking each step. Strongest burnDps wins; each
  // hit refreshes the duration. The ticks (in stepUnits) attribute to the applying tower.
  private applyBurn(u: Unit, dps: number, dur: number, srcId: number): void {
    const activeDps = this.simTime < u.burnUntil ? u.burnDps : 0;
    if (dps >= activeDps) {
      u.burnDps = dps;
      u.burnSourceId = srcId;
    }
    u.burnUntil = this.simTime + dur;
  }

  private kill(u: Unit): void {
    u.dead = true;
    this.charge += u.bounty; // the kill bounty (there is no score — the Maze Rating is the score)
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
      // Expire a slow whose timer has run out.
      if (u.slowFactor < 1 && this.simTime >= u.slowUntil) u.slowFactor = 1;
      // Tick an active burn (overcurrent DoT); it can kill and pays its bounty to the tower.
      if (u.burnDps > 0 && this.simTime < u.burnUntil) {
        const bd = u.burnDps * dt;
        // An ember flare a few times a second so the DoT reads without spamming.
        if (Math.floor(u.animT / 0.25) !== Math.floor((u.animT - dt) / 0.25)) this.fxQueue.push({ kind: "burnhit", x: u.x, y: u.y });
        if (u.invincible) {
          this.tallyRating(bd, u.burnSourceId); // finale boss: burn feeds the Maze Rating, never HP
        } else {
          const applied = Math.min(bd, Math.max(0, u.hp));
          u.hp -= bd;
          const src = this.componentById(u.burnSourceId);
          if (src) src.damageDealt += applied;
          if (u.hp <= 0) {
            if (src) src.kills += 1;
            this.kill(u);
            continue;
          }
        }
      } else if (u.burnDps > 0) {
        u.burnDps = 0; // burn expired
      }
      this.moveUnit(u, dt);
      if (!u.dead) u.progress = this.progressOf(u);
    }
  }

  private moveUnit(u: Unit, dt: number): void {
    if (u.route.length === 0) {
      u.route = this.board.routeFor({ x: u.x, y: u.y }, u.wpIndex, this.occ, u.flies);
      u.routeStep = 0;
    }
    let budget = u.speed * u.slowFactor * dt; // slowed units cover less ground (specs/towers.md)
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
    const c = this.board.chain[this.board.chain.length - 1]!;
    const p = tileCenter(c.col, c.row);
    // The invincible finale boss grounding out ENDS the finale and wins the run — it costs no
    // integrity (the run is already won); its Maze Rating is already tallied (specs/flow.md).
    if (u.invincible) {
      this.fxQueue.push({ kind: "leak", x: p.x, y: p.y });
      this.win();
      return;
    }
    this.integrity -= u.leak;
    this.leakCount += u.leak;
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
    this.activeWave = null;
    this.projectiles = [];
    if (this.wave >= this.diff.waves) {
      // The final wave is cleared — the run is WON. Before the Victory screen, the post-final
      // invincible OVERLOAD DYNAMO walks the maze once so its total damage rates the maze
      // (specs/enemies.md, specs/flow.md). No build phase follows, so no wave-clear bonus is paid.
      this.startFinale();
      return;
    }
    // Open the next (untimed) between-wave build phase; pay the small wave-clear bonus and
    // refresh the allowance. There is NO interest (specs/flow.md) — Charge stays scarce.
    this.charge += waveClearBonus(this.wave);
    this.phase = "build";
    this.stampsUsed = 0; // the 5-stamp allowance refreshes at the start of the build phase
    this.harvest = { mode: "none" };
    this.holding = false;
    this.nextWave = buildWave(this.wave + 1, this.diff);
  }

  // Begin the post-final MAZE-RATING finale (specs/enemies.md, specs/flow.md): spawn ONE
  // invincible Overload Dynamo at the Entry that walks the maze once. It cannot die — every
  // shot's full damage tallies into the Maze Rating (hit / tallyRating) — and when it grounds
  // out the run is won (leak → win). Building stays disabled (phase "wave"); the sim keeps
  // stepping with no more spawns (activeWave is null), so the boss simply walks and is shot.
  private startFinale(): void {
    this.finale = true;
    this.phase = "wave";
    this.selectedId = null;
    this.selectedIds = [];
    const u = this.makeUnit("dynamo");
    u.invincible = true;
    u.maxHp = u.hp; // display only — the invincible boss's HP never falls
    u.radius = 28; // a larger, looming overload core
    u.speed = FINALE_SPEED; // a brisk, dramatic single walk (not the slow campaign Dynamo)
    this.units = [u];
    this.recomputeAuras();
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
    this.mazeCache = null; // the harvest changed the walls (kept/consumed footprints)
    this.recomputeAuras(); // the harvest may have added an aura source / a buffable tower
    this.nextWave = buildWave(Math.min(this.wave + 1, this.diff.waves), this.diff);
  }

  // Resolve this level's KEEP (specs/build.md): promote the one kept candidate to a permanent
  // firing component, and harden every OTHER remaining candidate into an inert blocker.
  // COMBINING is resolved immediately when committed (it may already have run this level and
  // consumed some candidates and launched the wave itself), so here only a plain keep settles.
  private resolveHarvest(): void {
    const h = this.harvest;
    if (h.mode === "keep") {
      const cand = this.candidateById(h.id);
      if (cand) this.promoteToComponent(cand);
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
      comboLevel: 0,
      col: cand.col,
      row: cand.row,
      targeting: "first",
      cooldown: 0,
      fireAnim: 999,
      aimAngle: 0,
      kills: 0,
      damageDealt: 0,
      auraBonus: 0,
    };
    this.structures[i] = comp;
    const ctr = footprintCenter(comp.col, comp.row);
    this.fxQueue.push({ kind: "combine", x: ctr.x, y: ctr.y, tier: comp.tier });
  }

  // A base structure (candidate OR non-combo component) usable as a combine ANCHOR / ingredient:
  // it carries a (type, tier). A blocker or an existing combo tower is neither.
  private baseStructById(id: number): Candidate | Component | null {
    const s = this.structures.find((x) => x.id === id);
    if (!s) return null;
    if (s.kind === "candidate") return s;
    if (s.kind === "component" && !s.combo) return s;
    return null;
  }

  // IMMEDIATE quality-combine (specs/build.md): fold `anchorId` and `partnerId` — two base
  // structures of the SAME type + quality (each a candidate OR an existing component) — into one
  // component a tier higher, landing at the ANCHOR's footprint (so a combine can REPLACE an
  // existing tower, triggered from any tower in the set). The partner is consumed but its 2×2
  // footprint HARDENS INTO A BLOCKER so the maze wall is preserved (a combine never opens a
  // hole). Runs the instant it is committed — build phase OR live wave — and re-paths. Returns
  // true if it resolved.
  private combineQualityNow(anchorId: number, partnerId: number): boolean {
    const anchor = this.baseStructById(anchorId);
    const partner = this.baseStructById(partnerId);
    if (!anchor || !partner || anchor.id === partner.id) return false;
    if (anchor.tier >= MAX_TIER || partner.type !== anchor.type || partner.tier !== anchor.tier) return false;
    // A combine that folds in any candidate placed THIS build phase consumes the phase's roll —
    // it is the harvest, so it ends the build phase and launches the wave (specs/build.md).
    const consumedFreshRoll = anchor.kind === "candidate" || partner.kind === "candidate";
    const newTier = (anchor.tier + 1) as Tier;
    const pIdx = this.structures.findIndex((s) => s.id === partner.id);
    if (pIdx >= 0) this.structures[pIdx] = { id: partner.id, kind: "blocker", col: partner.col, row: partner.row } as Blocker;
    const i = this.structures.findIndex((s) => s.id === anchor.id);
    const comp: Component = {
      id: anchor.id,
      kind: "component",
      type: anchor.type,
      tier: newTier,
      comboLevel: 0,
      col: anchor.col,
      row: anchor.row,
      targeting: anchor.kind === "component" ? anchor.targeting : "first",
      cooldown: 0,
      fireAnim: 999,
      aimAngle: 0,
      kills: 0,
      damageDealt: 0,
      auraBonus: 0,
    };
    if (i >= 0) this.structures[i] = comp;
    else this.structures.push(comp);
    this.selectedId = comp.id;
    this.selectedIds = [];
    this.rePath();
    const ctr = footprintCenter(comp.col, comp.row);
    this.fxQueue.push({ kind: "combine", x: ctr.x, y: ctr.y, tier: comp.tier });
    this.sndQueue.push("combine");
    // A fresh-roll combine (COMBINE SPECIAL) is the phase's SOLE harvest: it discards any marked
    // KEEP (only one new tower a phase, specs/build.md) and sends the wave.
    if (consumedFreshRoll && this.phase === "build") {
      this.harvest = { mode: "none" };
      this.beginWave();
    }
    return true;
  }

  // IMMEDIATE recipe-combine (specs/build.md, specs/towers.md): fold `ingredientIds` (base
  // structures — candidates and/or existing base components — whose (type, tier) multiset
  // exactly matches `combo`'s recipe) into the combination tower `combo`, landing at `anchorId`
  // (which must be one of the ingredients). Every OTHER consumed ingredient HARDENS INTO A
  // BLOCKER in place (wall-neutral). Runs the instant it is committed — build phase OR live wave
  // — and re-paths. A combo lands at UPGRADE LEVEL 0 (the reduced landing block, specs/towers.md).
  private combineRecipeNow(anchorId: number, combo: ComboType, ingredientIds: number[]): boolean {
    const anchor = this.baseStructById(anchorId);
    if (!anchor || !ingredientIds.includes(anchorId)) return false;
    if (!this.recipeSatisfied(combo, ingredientIds)) return false;
    // Folding in any candidate placed THIS build phase consumes the phase's roll (specs/build.md):
    // the combine is the harvest, so it ends the build phase and launches the wave.
    const consumedFreshRoll = ingredientIds.some((iid) => this.candidateById(iid) !== null);
    for (const iid of ingredientIds) {
      if (iid === anchor.id) continue;
      const pIdx = this.structures.findIndex((s) => s.id === iid);
      if (pIdx >= 0) {
        const p = this.structures[pIdx]!;
        this.structures[pIdx] = { id: p.id, kind: "blocker", col: p.col, row: p.row } as Blocker;
      }
    }
    const i = this.structures.findIndex((s) => s.id === anchor.id);
    const comp: Component = {
      id: anchor.id,
      kind: "component",
      type: anchor.type, // an ingredient type, drives the base tint only
      tier: MAX_TIER, // sentinel; a combo's power axis is its comboLevel, not tier
      combo,
      comboLevel: 0, // lands WEAK (specs/towers.md — softened spike); upgrade to climb it
      col: anchor.col,
      row: anchor.row,
      targeting: "first",
      cooldown: 0,
      fireAnim: 999,
      aimAngle: 0,
      kills: 0,
      damageDealt: 0,
      auraBonus: 0,
    };
    if (i >= 0) this.structures[i] = comp;
    else this.structures.push(comp);
    this.selectedId = comp.id;
    this.selectedIds = [];
    this.rePath();
    const ctr = footprintCenter(comp.col, comp.row);
    this.fxQueue.push({ kind: "combine", x: ctr.x, y: ctr.y, tier: MAX_TIER, big: true });
    this.sndQueue.push("combine");
    // A fresh-roll combine (COMBINE SPECIAL) is the phase's SOLE harvest: it discards any marked
    // KEEP (only one new tower a phase, specs/build.md) and sends the wave.
    if (consumedFreshRoll && this.phase === "build") {
      this.harvest = { mode: "none" };
      this.beginWave();
    }
    return true;
  }

  private win(): void {
    // Victory: the Maze Rating is already tallied over the finale (specs/flow.md). Integrity
    // decided win/lose only — it adds nothing to the rating.
    this.finale = false;
    this.state = "victory";
    this.units = [];
    this.projectiles = [];
  }

  private lose(): void {
    this.integrity = 0;
    this.finale = false;
    this.state = "defeat";
    this.units = [];
    this.projectiles = [];
    this.activeWave = null;
  }

  // ---- The scrap-press build loop (specs/build.md) ----------------------------

  stampsLeft(): number {
    return Math.max(0, BUILDS_PER_LEVEL - this.stampsUsed);
  }
  // The press may be pulled only in the BUILD phase, with a stamp of the level's 5-allowance
  // left — placing rocks is FREE (GemTD-faithful), so the only limit is the five-per-level cap.
  canStamp(): boolean {
    return (
      this.state === "playing" &&
      this.phase === "build" &&
      !this.holding &&
      this.stampsLeft() > 0
    );
  }

  // Pull the press: arm a BLANK rock on the cursor (specs/build.md). No roll yet — the roll
  // happens when the rock lands (placeStamp). Placement is free. Returns true if armed.
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
  // on the current Refinement odds), spending one stamp of the level's allowance and landing a
  // CANDIDATE that walls and re-paths the floor (specs/build.md, specs/board.md). Placement is
  // FREE — no Charge. Dropping onto a blocker rerolls it in place. Returns the placed candidate,
  // or null if refused. Re-arms another rock afterward if the allowance still permits (continuous
  // placement). If no rock is held (the headless one-shot path), it arms one implicitly.
  placeStamp(col: number, row: number): Candidate | null {
    if (this.state !== "playing" || this.phase !== "build") return null;
    if (!this.holding && !this.canStamp()) return null;
    // No allowance left and not currently holding: refuse.
    if (this.stampsLeft() <= 0) return null;
    const onBlocker = this.blockerAtAnchor(col, row);
    if (!onBlocker && !this.board.canPlace(col, row, this.structures, this.units)) {
      return null; // illegal spot: keep holding, nothing spent
    }
    if (onBlocker) {
      // Reroll a blocker in place: remove it, drop a candidate on the same footprint.
      this.structures = this.structures.filter((s) => s.id !== onBlocker.id);
    }
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
    // another if the allowance still permits. canStamp() requires !holding, so holding MUST be
    // cleared first — otherwise it always reads false and the hand empties after one drop.
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
  // footprint and re-paths live. It NEVER refunds the stamp — a refund would let a player place a
  // rock, reject its roll, dismantle it, and re-roll indefinitely, defeating the scrap-press RNG.
  // A dismantle only ever OPENS routes, so it can never seal a segment.
  canRemove(id: number): boolean {
    if (this.state !== "playing" || this.phase !== "build") return false;
    return this.structures.some((s) => s.id === id);
  }
  removeStructure(id: number): boolean {
    if (this.state !== "playing" || this.phase !== "build") return false;
    const i = this.structures.findIndex((s) => s.id === id);
    if (i < 0) return false;
    // No stamp refund — the roll is spent for good. Drop the level's KEEP if this was the
    // kept candidate (combining is immediate now, so there is no deferred combine to unwind).
    if (this.harvest.mode === "keep" && this.harvest.id === id) this.harvest = { mode: "none" };
    this.structures.splice(i, 1);
    if (this.selectedId === id) this.selectedId = null;
    const si = this.selectedIds.indexOf(id);
    if (si >= 0) this.selectedIds.splice(si, 1);
    this.rePath();
    this.sndQueue.push("settle"); // a rock-settle thunk for the dismantle
    return true;
  }
  removeSelected(): void {
    if (this.selectedId != null) this.removeStructure(this.selectedId);
  }

  // ---- Keep (the one harvest per level) + IMMEDIATE combining (specs/build.md) --
  // KEEP is the level's single harvest — committing it IMMEDIATELY launches the wave (one
  // candidate → a permanent firing component; the rest harden into blockers). There is no SEND and
  // no reversible keep. COMBINING is separate: it is IMMEDIATE and may be done as often as
  // ingredients allow, in the build phase AND during a live wave — a fresh-consuming combine is
  // itself the harvest (and launches the wave), while a standing-only combine climbs the quality
  // ladder / builds the combo roster without ending the phase (specs/build.md, specs/controls.md).

  candidateById(id: number): Candidate | null {
    const s = this.structures.find((x) => x.id === id);
    return s && s.kind === "candidate" ? s : null;
  }
  candidates(): Candidate[] {
    return this.structures.filter((s): s is Candidate => s.kind === "candidate");
  }

  // KEEP the selected candidate as this level's harvest — and, because a harvest IS the wave
  // trigger (there is no SEND button, specs/build.md, specs/flow.md), it **immediately launches
  // the wave**: the candidate becomes a permanent firing component and every other candidate
  // hardens into a blocker. There is no reversible/deferred keep — place and compare all rocks
  // first, then commit the one you want. Every level must harvest to advance (specs/build.md).
  keep(id: number): void {
    if (this.phase !== "build") return;
    if (!this.candidateById(id)) return;
    this.harvest = { mode: "keep", id };
    this.beginWave();
  }
  keepSelected(): void {
    const s = this.selected();
    if (s && s.kind === "candidate") this.keep(s.id);
  }

  // MERGE a fresh candidate INTO a matching STANDING tower, landing the higher-tier result AT the
  // existing tower's footprint (specs/build.md). A quality-combine lands at whichever piece you
  // initiate from, so this is the from-the-candidate way to fold a just-placed roll into a
  // standing tower WITHOUT a keep step first — the candidate is selected (the natural instinct),
  // yet the result stays where the maze already has its tower. It consumes the fresh roll, so — like
  // any fresh-consuming combine — it IS the level's harvest and launches the wave.
  // mergeTargetFor returns the standing base tower this candidate would merge into (same TYPE +
  // QUALITY, below Tesla-Prime), or null. Combos (terminal) and T5 towers are never merge targets.
  mergeTargetFor(id: number): Component | null {
    const cand = this.candidateById(id);
    if (!cand || cand.tier >= MAX_TIER) return null;
    for (const s of this.structures) {
      if (s.kind === "component" && !s.combo && s.type === cand.type && s.tier === cand.tier) return s;
    }
    return null;
  }
  mergeInto(candidateId: number, targetId: number): boolean {
    const cand = this.candidateById(candidateId);
    const target = this.baseStructById(targetId);
    if (!cand || !target || target.kind !== "component" || target.combo) return false;
    if (target.type !== cand.type || target.tier !== cand.tier) return false;
    // Anchor = the standing tower (result lands there); partner = the fresh candidate (consumed).
    return this.combineQualityNow(targetId, candidateId);
  }
  mergeSelectedInto(): boolean {
    if (this.selectedId == null) return false;
    const target = this.mergeTargetFor(this.selectedId);
    return target ? this.mergeInto(this.selectedId, target.id) : false;
  }

  // Does a same-type + same-quality match exist for this base structure (another candidate or an
  // existing base component), so a quality-COMBINE is offered? Tesla-Prime never combines, and a
  // combination tower / blocker is never a base structure (specs/build.md).
  canCombine(c: Candidate | Component): boolean {
    return c.tier < MAX_TIER && this.combinePartnerOf(c) !== null;
  }
  // Auto-picks a partner, PRIORITIZING a fresh candidate over a standing component (specs/build.md):
  // consuming a build-phase roll (→ COMBINE SPECIAL, ends the phase) is preferred to eating an
  // invested tower, so an un-targeted combine spends the expendable rolls first.
  combinePartnerOf(c: Candidate | Component): Candidate | Component | null {
    if (c.tier >= MAX_TIER) return null;
    let component: Component | null = null;
    for (const s of this.structures) {
      if (s.id === c.id) continue;
      if (s.kind === "candidate") {
        if (s.type === c.type && s.tier === c.tier) return s; // a fresh roll wins outright
      } else if (s.kind === "component" && !s.combo && component === null) {
        if (s.type === c.type && s.tier === c.tier) component = s;
      }
    }
    return component;
  }

  // The current explicit COMBINE set: the primary selection plus any shift-added structures,
  // filtered to base structures (candidates / base components), primary first, deduped. This is
  // what an EXPLICIT (multi-select) combine folds (specs/controls.md).
  combineSet(): number[] {
    const ids: number[] = [];
    const push = (id: number | null): void => {
      if (id == null) return;
      if (ids.includes(id)) return;
      if (this.baseStructById(id)) ids.push(id);
    };
    push(this.selectedId);
    for (const id of this.selectedIds) push(id);
    return ids;
  }

  // Commit a combine from the current selection (the generic COMBINE action, specs/controls.md).
  // With an EXPLICIT multi-select (≥2 base structures chosen), fold exactly that set — a pair of
  // matching rolls quality-combines, a recipe multiset assembles the combo — landing at the
  // PRIMARY. With only one selected, AUTO-RESOLVE: quality-combine the primary with the game's
  // choice of partner, else assemble its single reachable recipe. Immediate; returns true if it
  // combined.
  combineSelection(): boolean {
    const set = this.combineSet();
    if (set.length === 0) return false;
    const anchor = set[0]!;
    if (set.length >= 2) {
      // Explicit set: try a quality pair, then a recipe multiset that this exact set satisfies.
      if (set.length === 2) {
        const a = this.baseStructById(set[0]!)!;
        const b = this.baseStructById(set[1]!)!;
        if (a.tier < MAX_TIER && a.type === b.type && a.tier === b.tier) return this.combineQualityNow(anchor, set[1]!);
      }
      const combo = this.comboMatching(set);
      if (combo) return this.combineRecipeNow(anchor, combo, set);
      return false;
    }
    // Auto-resolve for the lone primary.
    const base = this.baseStructById(anchor);
    if (!base) return false;
    const partner = this.combinePartnerOf(base);
    if (partner) return this.combineQualityNow(anchor, partner.id);
    const recipes = this.reachableCombosFor(anchor);
    if (recipes.length >= 1) return this.combineRecipeNow(anchor, recipes[0]!.combo, recipes[0]!.ingredientIds);
    return false;
  }
  // The generic quality-combine convenience (dev API / hotkey): auto-resolve a partner for `id`.
  combine(id: number): boolean {
    const base = this.baseStructById(id);
    if (!base) return false;
    const partner = this.combinePartnerOf(base);
    if (!partner) return false;
    return this.combineQualityNow(id, partner.id);
  }
  combineSelected(): boolean {
    return this.combineSelection();
  }

  // The exact combo an explicit ingredient set assembles, or null: the set's (type,tier)
  // multiset must equal a recipe's, with every id a valid base structure (specs/towers.md).
  private comboMatching(ids: number[]): ComboType | null {
    const keys: string[] = [];
    const seen = new Set<number>();
    for (const id of ids) {
      if (seen.has(id)) return null;
      seen.add(id);
      const s = this.structures.find((x) => x.id === id);
      const k = s ? this.ingredientKeyOf(s) : null;
      if (!k) return null;
      keys.push(k);
    }
    const key = keys.sort().join(",");
    for (const combo of COMBO_ORDER) if (recipeKey(COMBOS[combo].recipe) === key) return combo;
    return null;
  }

  // ---- Recipe combine — assemble a combination tower (specs/build.md, specs/towers.md) ---
  // The board's INGREDIENT pool: candidates and base components (not blockers, not existing
  // combos — combos are terminal and cannot be ingredients). Each contributes its (type,tier).
  private ingredientKeyOf(s: Structure): string | null {
    if (s.kind === "candidate") return `${s.type}@${s.tier}`;
    if (s.kind === "component" && !s.combo) return `${s.type}@${s.tier}`;
    return null;
  }

  // Every combination-tower recipe the board can satisfy INCLUDING `anchor` (a candidate OR an
  // existing base component) as one ingredient, each with a concrete set of ingredient ids (the
  // anchor first). Used by the inspector to offer COMBINE → <combo> and by dev drivers. Auto-
  // picks the remaining ingredients; an explicit multi-select can override which copies (below).
  reachableCombos(anchor: Candidate | Component): { combo: ComboType; ingredientIds: number[] }[] {
    const anchorKey = `${anchor.type}@${anchor.tier}`;
    const avail = new Map<string, number[]>();
    for (const s of this.structures) {
      const k = this.ingredientKeyOf(s);
      if (!k) continue;
      if (!avail.has(k)) avail.set(k, []);
      avail.get(k)!.push(s.id);
    }
    // Auto-pick prioritizes CONSUMING fresh candidates over standing components (specs/build.md):
    // sort each ingredient pool candidate-first so an un-targeted recipe spends this phase's rolls
    // (→ COMBINE SPECIAL, ends the phase) before eating invested towers.
    for (const list of avail.values()) {
      list.sort((a, b) => (this.candidateById(b) ? 1 : 0) - (this.candidateById(a) ? 1 : 0));
    }
    const out: { combo: ComboType; ingredientIds: number[] }[] = [];
    for (const combo of COMBO_ORDER) {
      const need = new Map<string, number>();
      for (const ing of COMBOS[combo].recipe) {
        const k = `${ing.type}@${ing.tier}`;
        need.set(k, (need.get(k) ?? 0) + 1);
      }
      if (!need.has(anchorKey)) continue; // the anchor must be one of the ingredients
      let ok = true;
      for (const [k, c] of need) {
        if ((avail.get(k)?.length ?? 0) < c) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      const ids: number[] = [];
      for (const [k, c] of need) {
        let list = avail.get(k)!.slice();
        if (k === anchorKey) list = [anchor.id, ...list.filter((id) => id !== anchor.id)]; // spend THIS anchor
        for (let i = 0; i < c; i++) ids.push(list[i]!);
      }
      out.push({ combo, ingredientIds: ids });
    }
    return out;
  }

  // Convenience for the UI: the reachable combos for a structure id (empty unless it is a base
  // structure — a candidate or a base component).
  reachableCombosFor(id: number): { combo: ComboType; ingredientIds: number[] }[] {
    const base = this.baseStructById(id);
    return base ? this.reachableCombos(base) : [];
  }

  // Does `ingredientIds` still exactly match combo's recipe multiset (all present, distinct,
  // valid base ingredients)? Guards combineRecipeNow against a board changed since the offer.
  private recipeSatisfied(combo: ComboType, ingredientIds: number[]): boolean {
    const seen = new Set<number>();
    const keys: string[] = [];
    for (const id of ingredientIds) {
      if (seen.has(id)) return false;
      seen.add(id);
      const s = this.structures.find((x) => x.id === id);
      if (!s) return false;
      const k = this.ingredientKeyOf(s);
      if (!k) return false;
      keys.push(k);
    }
    return keys.sort().join(",") === recipeKey(COMBOS[combo].recipe);
  }

  // Immediately assemble combo from structure `id` (the anchor / initiator). If the player has an
  // EXPLICIT multi-select that exactly satisfies this recipe (with the anchor), those exact
  // copies are spent (so the player chooses WHICH duplicates fold); otherwise the ingredients are
  // auto-picked from the board. Immediate; build phase OR live wave. Returns true if it combined.
  combineRecipe(id: number, combo: ComboType): boolean {
    const base = this.baseStructById(id);
    if (!base) return false;
    const set = this.combineSet();
    if (set.length >= 2 && set[0] === id && this.comboMatching(set) === combo) {
      return this.combineRecipeNow(id, combo, set);
    }
    const opt = this.reachableCombos(base).find((o) => o.combo === combo);
    if (!opt) return false;
    return this.combineRecipeNow(id, combo, opt.ingredientIds);
  }
  combineRecipeSelected(combo: ComboType): boolean {
    return this.selectedId != null ? this.combineRecipe(this.selectedId, combo) : false;
  }

  // The three build actions differ only in what they consume (specs/build.md): a COMBINE SPECIAL
  // folds in ≥1 fresh candidate (a build-phase roll) and so ENDS the phase; a plain COMBINE folds
  // only standing towers and leaves the phase running (the only combine usable during a wave).
  // These predict, for the inspector's label, whether committing the offered combine would end
  // the phase — mirroring exactly how combineSelection / combineRecipe resolve the ingredient set.
  private idsAreSpecial(ids: number[]): boolean {
    return this.phase === "build" && ids.some((id) => this.candidateById(id) !== null);
  }
  qualityCombineIsSpecial(id: number): boolean {
    if (this.phase !== "build") return false;
    const base = this.baseStructById(id);
    if (!base) return false;
    const set = this.combineSet();
    if (set.length >= 2 && set[0] === id) return this.idsAreSpecial(set);
    if (base.kind === "candidate") return true;
    const p = this.combinePartnerOf(base);
    return p !== null && p.kind === "candidate";
  }
  recipeCombineIsSpecial(id: number, combo: ComboType): boolean {
    if (this.phase !== "build") return false;
    const set = this.combineSet();
    if (set.length >= 2 && set[0] === id && this.comboMatching(set) === combo) return this.idsAreSpecial(set);
    const opt = this.reachableCombosFor(id).find((o) => o.combo === combo);
    return opt ? this.idsAreSpecial(opt.ingredientIds) : false;
  }

  // ---- UPGRADE QUALITY — the Refinement track (specs/build.md) -----------------

  refineCost(): number | null {
    return nextRefineCost(this.refinement);
  }
  canUpgradeQuality(): boolean {
    // Refining the press is allowed in ANY phase (specs/build.md): it only biases FUTURE rolls,
    // so there is no reason to block it during a live wave — and it keeps Charge sinks available
    // while the wave runs, consistent with combining and combo upgrades being any-phase.
    const cost = this.refineCost();
    return this.state === "playing" && cost !== null && this.charge >= cost;
  }
  upgradeQuality(): boolean {
    const cost = this.refineCost();
    if (!this.canUpgradeQuality() || cost === null) return false;
    this.charge -= cost;
    this.refinement = (this.refinement + 1) as Refinement;
    this.sndQueue.push("combine"); // a bright confirm cue for the refinement
    return true;
  }

  // ---- DOWNGRADE a candidate — KEEP it one tier lower (specs/build.md) ----------
  // Refining the press biases rolls UP, which can leave a player unable to produce a LOW-tier
  // ingredient a recipe still needs. DOWNGRADE fixes that: it is a **KEEP at one quality tier
  // lower** — it harvests the selected CANDIDATE (a rock placed this phase) as a permanent
  // firing component at (tier − 1), FREE, and — because it is the level's harvest — it LAUNCHES
  // the wave (like KEEP / MERGE). To use the lowered tower as a recipe ingredient, fold it with a
  // standing COMBINE during the wave (combining is allowed mid-wave). It applies ONLY to
  // candidates at Tuned (T2)+: a STANDING component (already committed), a combination tower (no
  // tier), a blocker, and a Scrap (T1) candidate cannot be downgraded.
  canDowngrade(id: number): boolean {
    if (this.state !== "playing" || this.phase !== "build") return false;
    const cand = this.candidateById(id);
    return !!cand && cand.tier > 1;
  }
  downgrade(id: number): boolean {
    if (!this.canDowngrade(id)) return false;
    const cand = this.candidateById(id)!;
    cand.tier = (cand.tier - 1) as Tier;
    const ctr = footprintCenter(cand.col, cand.row);
    this.fxQueue.push({ kind: "buildspark", x: ctr.x, y: ctr.y, tier: cand.tier });
    // DOWNGRADE is a KEEP at the lowered tier: it is the level's harvest, so it launches the wave.
    this.harvest = { mode: "keep", id };
    this.beginWave();
    return true;
  }
  downgradeSelected(): void {
    if (this.selectedId != null) this.downgrade(this.selectedId);
  }

  // ---- UPGRADE a combination tower (specs/towers.md, specs/build.md) -----------
  // A combo lands at level 0 (weakened) and CLIMBS with Charge — the softened spike + gold sink.
  // Allowed in ANY phase (specs/towers.md, specs/build.md), up to MAX_COMBO_LEVEL; each level
  // scales its damage/range (comboStats). Upgrading mid-wave is consistent with combining mid-wave
  // and makes the upgrade affordance visible while a wave is live.
  comboUpgradeCostFor(c: Component): number | null {
    return c.combo ? comboUpgradeCost(c.combo, c.comboLevel) : null;
  }
  canUpgradeCombo(id: number): boolean {
    if (this.state !== "playing") return false;
    const s = this.structures.find((x) => x.id === id);
    if (!s || s.kind !== "component" || !s.combo) return false;
    const cost = comboUpgradeCost(s.combo, s.comboLevel);
    return cost !== null && this.charge >= cost;
  }
  upgradeCombo(id: number): boolean {
    if (!this.canUpgradeCombo(id)) return false;
    const s = this.structures.find((x) => x.id === id) as Component;
    const cost = comboUpgradeCost(s.combo!, s.comboLevel)!;
    this.charge -= cost;
    s.comboLevel = Math.min(MAX_COMBO_LEVEL, s.comboLevel + 1);
    if (comboStats(s.combo!, s.comboLevel).auraRadius > 0) this.recomputeAuras();
    this.sndQueue.push("combine");
    const ctr = footprintCenter(s.col, s.row);
    this.fxQueue.push({ kind: "combine", x: ctr.x, y: ctr.y, tier: MAX_TIER, big: true });
    return true;
  }
  upgradeComboSelected(): void {
    if (this.selectedId != null) this.upgradeCombo(this.selectedId);
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

  // ---- Selection (single + explicit multi-select for combining) ---------------

  select(id: number | null): void {
    this.selectedId = id;
    this.selectedIds = []; // a plain select clears any explicit multi-select set
  }
  // Plain select (clears the multi-select) or, with `additive` (shift-click), TOGGLE a structure
  // in the explicit combine set (specs/controls.md). The primary stays the inspector target; the
  // additive ids are the extra copies a combine will fold. Only base structures add to the set.
  selectAt(x: number, y: number, additive = false): void {
    const s = this.structureAt(x, y);
    if (!additive) {
      this.selectedId = s ? s.id : null;
      this.selectedIds = [];
      return;
    }
    if (!s) return;
    if (this.selectedId == null) {
      this.selectedId = s.id;
      this.selectedIds = [];
      return;
    }
    if (s.id === this.selectedId) return; // shift-clicking the primary is a no-op
    const i = this.selectedIds.indexOf(s.id);
    if (i >= 0) this.selectedIds.splice(i, 1);
    else if (this.baseStructById(s.id)) this.selectedIds.push(s.id);
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
  // The extra multi-selected structures (excluding the primary) that still exist, for rendering.
  extraSelected(): Structure[] {
    const out: Structure[] = [];
    for (const id of this.selectedIds) {
      const s = this.structures.find((x) => x.id === id);
      if (s) out.push(s);
    }
    return out;
  }

  // ---- Wave control (specs/flow.md, specs/controls.md) ------------------------
  // There is NO player SEND: a wave starts when the level's HARVEST is committed — a KEEP or a
  // fresh-consuming COMBINE (which call beginWave themselves). Every level must harvest to
  // advance (specs/build.md), so no separate start action is surfaced to the player. startWave()
  // remains only as the HEADLESS/dev launcher (the balance harness builds via dev helpers, then
  // launches the wave directly); it is never wired to a button or key.
  startWave(): void {
    if (this.state !== "playing" || this.phase !== "build") return;
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

  // ---- Maze length (specs/board.md, specs/controls.md) ------------------------
  // The GROUND route the Load walks: the shortest OPEN path through the ordered waypoint
  // chain around the current walls, as tile-center points. Flyers ignore the maze, so this is
  // the walking units' route only. Cached until the walls change (lazy; recomputed here).
  private computeMaze(): { path: Pt[]; lenTiles: number } {
    if (this.mazeCache) return this.mazeCache;
    const occ = this.board.occupancy(this.structures);
    const chain = this.board.chain;
    const path: Pt[] = [];
    const c0 = chain[0]!;
    path.push(tileCenter(c0.col, c0.row));
    for (let i = 1; i < chain.length; i++) {
      const a = chain[i - 1]!;
      const b = chain[i]!;
      const seg = this.board.pathTiles(a, b, occ);
      if (seg && seg.length > 0) {
        for (let j = 1; j < seg.length; j++) path.push(seg[j]!);
      } else {
        // Never-seal keeps every segment open, so this is a safety fallback only.
        path.push(tileCenter(b.col, b.row));
      }
    }
    let d = 0;
    for (let i = 1; i < path.length; i++) {
      d += Math.hypot(path[i]!.x - path[i - 1]!.x, path[i]!.y - path[i - 1]!.y);
    }
    this.mazeCache = { path, lenTiles: d / TILE };
    return this.mazeCache;
  }
  // The ground maze route as tile-center points (for the hover overlay).
  mazePath(): Pt[] {
    return this.computeMaze().path;
  }
  // The ground maze length in TILES (the HUD readout) — longer maze = more time under fire.
  mazeLengthTiles(): number {
    return this.computeMaze().lenTiles;
  }

  // ---- Merge highlight (specs/build.md, specs/controls.md) --------------------
  // The structures that will FOLD TOGETHER if the player combines now, so the renderer pulses
  // them and the player sees exactly what merges. With an EXPLICIT multi-select (≥2 base
  // structures), those exact pieces are marked as "committed" (the precise set a combine folds).
  // With a lone base selection, every eligible partner it COULD merge with is marked (its
  // quality-combine match plus every reachable combination-tower ingredient). Combining is
  // immediate, so there is no deferred harvest to reflect — this is purely the live selection.
  mergeHighlight(): { primaryId: number | null; partnerIds: Set<number>; committed: boolean } {
    const partnerIds = new Set<number>();
    const set = this.combineSet();
    if (set.length >= 2) {
      for (let i = 1; i < set.length; i++) partnerIds.add(set[i]!);
      return { primaryId: set[0]!, partnerIds, committed: true };
    }
    const sel = this.selected();
    if (sel && (sel.kind === "candidate" || (sel.kind === "component" && !sel.combo))) {
      const qp = this.combinePartnerOf(sel);
      if (qp) partnerIds.add(qp.id);
      for (const rec of this.reachableCombos(sel)) {
        for (const id of rec.ingredientIds) if (id !== sel.id) partnerIds.add(id);
      }
      return { primaryId: sel.id, partnerIds, committed: false };
    }
    return { primaryId: null, partnerIds, committed: false };
  }

  // Every base structure that could fold into SOME combine right now — a quality pair or a
  // reachable combination-tower recipe (specs/build.md). The renderer pulses these AT ALL TIMES
  // (not only when one is selected) so the player is told, unprompted, that combines are available
  // and exactly which pieces can merge. A piece with no partner and no reachable recipe is omitted.
  combinablePieces(): Set<number> {
    const ids = new Set<number>();
    for (const s of this.structures) {
      if (s.kind !== "candidate" && !(s.kind === "component" && !s.combo)) continue;
      const base = s as Candidate | Component;
      if (this.combinePartnerOf(base) !== null || this.reachableCombos(base).length > 0) ids.add(base.id);
    }
    return ids;
  }

  // ---- Speed / pause (specs/controls.md) --------------------------------------

  cycleSpeed(): void {
    // 1× → 2× → 4× → 8× → 1× (specs/controls.md). The fixed-timestep loop substeps, so a
    // higher speed just runs more fixed ticks per frame — the sim stays stable at 8×.
    this.speed = this.speed === 1 ? 2 : this.speed === 2 ? 4 : this.speed === 4 ? 8 : 1;
  }
  togglePause(): void {
    if (this.state === "playing") this.paused = !this.paused;
  }

  // ---- Queries ----------------------------------------------------------------

  // A component's live stats INCLUDING its cached external aura buff (specs/towers.md). A
  // combination tower reads its fixed block; a base component derives from (type, tier).
  statsOf(c: Component): CompStats {
    const st = this.baseStatsOf(c);
    if (c.auraBonus > 0 && st.dmg > 0) return { ...st, dmg: Math.round(st.dmg * (1 + c.auraBonus)) };
    return st;
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
    this.holding = false;
    this.beginWave();
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
      comboLevel: 0,
      col: anchor.col,
      row: anchor.row,
      targeting: "first",
      cooldown: 0,
      fireAnim: 999,
      aimAngle: 0,
      kills: 0,
      damageDealt: 0,
      auraBonus: 0,
    };
    this.structures.push(comp);
    this.selectedId = comp.id;
    this.rePath();
    return comp;
  }

  // Place a COMBINATION TOWER of an exact combo at (or nearest-legal to) an anchor, no cost,
  // landing active — the deterministic counterpart to a recipe combine, used by the balance
  // harness / dev drivers to lay out a board with combos without assembling ingredients.
  devPlaceCombo(combo: ComboType, col: number, row: number, level = 0): Component | null {
    const anchor = this.board.nearestLegalAnchor(col, row, this.structures, this.units);
    if (!anchor) return null;
    const comp: Component = {
      id: this.nextId++,
      kind: "component",
      type: COMBOS[combo].recipe[0]!.type,
      tier: MAX_TIER,
      combo,
      comboLevel: Math.max(0, Math.min(MAX_COMBO_LEVEL, level)),
      col: anchor.col,
      row: anchor.row,
      targeting: "first",
      cooldown: 0,
      fireAnim: 999,
      aimAngle: 0,
      kills: 0,
      damageDealt: 0,
      auraBonus: 0,
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
