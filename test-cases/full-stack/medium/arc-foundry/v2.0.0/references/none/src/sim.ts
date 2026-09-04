// Arc Foundry — the simulation (specs/yard.md, specs/pathing.md, specs/components.md,
// specs/combinations.md, specs/scrap-press.md, specs/campaign.md, specs/economy.md).
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
  COMBO_FIRE_CUE,
  COMPONENT_ORDER,
  DEFAULT_MAP,
  DEFAULT_SEED,
  DIFFICULTY,
  FOUNDRY_DEBUG_VERSION,
  LOAD,
  MAX_COMBO_LEVEL,
  MAX_TIER,
  START_CHARGE,
  START_INTEGRITY,
  FIRE_CUE,
  OVERLOAD_SPEED,
  PROJECTILE_HIT_R,
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
  LoadType,
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

// The seed for the COMBAT rng — crit rolls (specs/components.md). Separate from the press so
// build rolls and combat randomness are independent and each stays deterministic.
const COMBAT_SEED = 0x2f9d3b17;

// How long an aura source waits between pulses, in seconds. Shorter than the produced
// system's own run, so a structure that keeps standing is marked continuously rather than
// blinking between pulses.
const AURA_PULSE_PERIOD = 0.6;

export class Game {
  map: MapDef; // the chosen yard (specs/yard.md); set by startOn() before a run
  board: Board; // the grid, waypoint chain, and pathing of the current map
  diff: DifficultyDef = DIFFICULTY.medium; // the chosen difficulty (specs/difficulty.md)

  state: GameState = "title";
  phase: Phase = "build";
  paused = false;

  charge = 0; // money (specs/economy.md)
  integrity = 0; // Grid Integrity (lives)
  maxIntegrity = 0;
  // The run keeps NO running score (specs/campaign.md). Its one end-of-run number is the MAZE
  // RATING: total damage dealt to the post-final invincible Overload Dynamo. It accrues only
  // during the finale; a defeat never reaches it (0). Integrity only gates win/lose.
  mazeRating = 0;
  finale = false; // the post-final Overload Dynamo is walking the maze (specs/enemies.md)
  wave = 0; // 0 before Wave 1 (the untimed opening build phase)
  // The driver's hold on the resolution that ends a wave (specs/instrumentation.md). While
  // it is on, a wave whose units have all died or leaked stays running: no bonus is paid,
  // the counter does not advance, and no build phase opens. Every other rule keeps running.
  waveHeld = false;
  speed: 1 | 2 | 4 | 8 = 1;

  units: Unit[] = [];
  projectiles: Projectile[] = []; // shots / arcs in flight (specs/components.md)
  // components, candidates, and blockers — the maze (specs/scrap-press.md)
  structures: Structure[] = [];

  // The scrap-press seed. `reset` is what sets it and the only thing that does, so the
  // same seed and the same calls reach the same run every time (specs/instrumentation.md).
  pressSeed = PRESS_SEED;

  // Build / selection UI state.
  // The highlighted entry on the menu screen showing, counted from 0 (specs/ui.md). It lives
  // on the game because `reset` restores it and the snapshot reports it.
  menuIndex = 0;
  holding = false; // a blank rock is on the cursor (rolls on placement, specs/scrap-press.md)
  selectedId: number | null = null; // the PRIMARY selection (drives the inspector + range ring)
  // The EXPLICIT combine set, the primary first: the player shift-clicks the exact copies
  // to fold (specs/controls.md, specs/scrap-press.md). It is state of its own rather than a
  // projection of the selection, so `clearCombineSet` empties it while the selection stands,
  // and the game then resolves a combine's ingredients itself.
  combineIds: number[] = [];
  stampsUsed = 0; // rocks placed of the level's BUILDS_PER_LEVEL allowance (decrements on PLACEMENT)
  refinement: Refinement = 0; // UPGRADE QUALITY level (biases the quality roll, specs/scrap-press.md)
  harvest: Harvest = { mode: "none" }; // transient: the level's keep/combine, resolved as it launches the wave
  pointerX = -1; // logical-space pointer, for the held-rock ghost / range preview
  pointerY = -1;

  // Run tallies surfaced to the balance harness / HUD.
  kills = 0;
  leakCount = 0;

  // The next roll armed by the debug/automation API's setNextRoll (specs/instrumentation.md):
  // a one-shot override so a scenario can reproduce a specific board. When set, the NEXT
  // placeRock rolls this exact (type, tier) instead of drawing from the seeded press, then
  // clears. Null in normal play — placement rolls the real seeded RNG.
  armedRoll: { type: ComponentType; tier: Tier } | null = null;

  // View-only flags MIRRORED from the presentation layer purely so snapshot() / the debug
  // overlay can report them (specs/instrumentation.md). They never touch the simulation; the
  // bootstrap loop keeps them in sync with the real audio-mute and HUD-overlay toggles.
  muted = false;
  uiCombos = false;
  uiBoard = false;

  // Event queues drained by the presentation layer each frame.
  fxQueue: FxEvent[] = [];
  sndQueue: Cue[] = [];
  // The cues already raised on the update in progress. An update that raises the same event
  // several times plays its cue once (specs/ui.md), so a frame on which a whole pack dies
  // plays one kill cue rather than one per unit.
  private cuesThisStep = new Set<Cue>();

  // Internal, deterministic state (not part of the read surface).
  private activeWave: Wave | null = null;
  // The driver's hold on the spawner (specs/instrumentation.md). While it is engaged the run
  // is in a live wave whose spawn schedule is empty, so nothing arrives that the debug
  // surface did not release. `startRun` and `reset` release it.
  private spawnerHeld = false;
  private nextWave: Wave;
  private spawnCursor = 0;
  private waveClock = 0; // ms into the active wave
  private simTime = 0; // seconds of live-wave sim elapsed this run (drives status-effect timers)
  private nextId = 1;
  private press: Rng;
  private combat: Rng; // crit rolls (specs/components.md) — deterministic, separate from the press
  private occ: Occupancy; // cached occupancy of the current structures + housings
  // Cached ground maze route + its length in tiles (the HUD readout + hover overlay). The
  // route only changes when the walls do, so it is recomputed lazily and invalidated on any
  // structure change (specs/pathing.md — the route is recomputed the moment the
  // walls change). Null = dirty.
  private mazeCache: { path: Pt[]; lenTiles: number } | null = null;

  constructor(
    map: MapDef = DEFAULT_MAP,
    diff: DifficultyDef = DIFFICULTY.medium,
  ) {
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
    this.charge = START_CHARGE;
    this.integrity = START_INTEGRITY;
    this.maxIntegrity = START_INTEGRITY;
    this.mazeRating = 0;
    this.finale = false;
    this.wave = 0;
    this.speed = 1;
    this.units = [];
    this.projectiles = [];
    this.structures = [];
    this.holding = false;
    this.selectedId = null;
    this.combineIds = [];
    this.stampsUsed = 0;
    this.refinement = 0;
    this.harvest = { mode: "none" };
    this.menuIndex = 0;
    // The pointer is the runtime layer's, not the game's, so beginning a run does not move it.
    this.kills = 0;
    this.leakCount = 0;
    this.fxQueue = [];
    this.sndQueue = [];
    this.activeWave = null;
    this.spawnerHeld = false;
    this.waveHeld = false;
    this.spawnCursor = 0;
    this.waveClock = 0;
    this.simTime = 0;
    this.nextId = 1;
    // The press keeps whatever `setNextRoll` armed: only a rock consuming it or
    // `clearNextRoll` clears the arming (specs/instrumentation.md).
    this.press = new Rng(this.pressSeed);
    // Derive the combat (crit) rng from the press seed too, so seeding the run through
    // reset({seed}) makes EVERY random draw — build rolls and crit rolls — reproducible
    // (specs/instrumentation.md). The default fixed press seed keeps COMBAT_SEED's role.
    this.combat = new Rng((this.pressSeed ^ COMBAT_SEED) >>> 0);
    this.nextWave = buildWave(1, this.diff);
    this.occ = this.board.occupancy(this.structures);
    this.mazeCache = null;
  }

  // ---- Fixed simulation step (specs/controls.md) ------------------------------
  // ---- Render interpolation ---------------------------------------------
  // The simulation advances in whole FIXED_STEP ticks, but a frame is presented
  // whenever the display asks for one, and the two rates do not divide evenly.
  // `syncView` stamps where the units and projectiles stood when the step
  // began, and the animation loop sets `renderAlpha` to the fraction of the next
  // step the wall clock has already covered; render.ts draws between the two.
  // The board, the components, and the walls are static and need none of it.
  // Nothing here feeds back into the simulation — these are written by the step
  // and read by the renderer, never the other way about, so the same tick
  // sequence produces the same state whatever the frame rate.
  renderAlpha = 0;

  // Stamp the interpolation window, once per simulation step.
  syncView(): void {
    for (const u of this.units) {
      u.prevX = u.x;
      u.prevY = u.y;
    }
    for (const pr of this.projectiles) {
      pr.prevX = pr.x;
      pr.prevY = pr.y;
    }
  }

  // Raise one cue on the update in progress, at most once (specs/ui.md).
  private raiseCue(cue: Cue): void {
    if (this.cuesThisStep.has(cue)) return;
    this.cuesThisStep.add(cue);
    this.sndQueue.push(cue);
  }

  fixedStep(dt: number): void {
    // The simulation clock runs on the `playing` screen and nowhere else, and it stops dead
    // under the in-place pause (specs/controls.md). Every duration and every rate in the game
    // is measured against it.
    if (this.state !== "playing" || this.paused) return;
    this.cuesThisStep.clear();
    this.simTime += dt;

    // Grid Integrity at or below zero ends the run at any point (specs/economy.md), so
    // defeat is resolved before the phase decides how much of the tick runs: a build
    // phase with the grid already at zero ends in defeat exactly as a live wave does.
    if (this.integrity <= 0) {
      this.lose();
      return;
    }

    // A standing source is marked whatever the phase, so this runs above the build-phase
    // return.
    this.stepAuras(dt);

    if (this.phase === "build") {
      // A build phase is untimed (specs/campaign.md): nothing starts the wave but the level's
      // harvest. The clock still runs, so a status effect posed in a build phase runs down.
      for (const s of this.structures)
        if (s.kind === "component") s.fireAnim += dt;
      return;
    }

    // A live wave, or the finale.
    this.waveClock += dt * 1000;
    this.spawnDue();
    this.stepComponents(dt);
    this.stepUnits(dt);
    this.stepProjectiles(dt); // move shots after units move, so homing stays accurate
    this.cullDead();
    // Defeat resolves immediately, so the leak that empties the grid on the very tick
    // that would clear the wave ends the run instead of opening a build phase.
    if (this.integrity <= 0) {
      this.lose();
      return;
    }
    this.checkWaveEnd();
  }

  private spawnDue(): void {
    const w = this.activeWave;
    if (!w) return;
    while (
      this.spawnCursor < w.events.length &&
      w.events[this.spawnCursor]!.atMs <= this.waveClock
    ) {
      this.units.push(this.makeUnit(w.events[this.spawnCursor]!.type));
      this.spawnCursor++;
    }
  }

  // ---- Unit construction ------------------------------------------------------
  private makeUnit(type: Unit["type"]): Unit {
    const def = LOAD[type];
    // The scaling of specs/enemies.md is defined FROM WAVE 1, and a run reaches
    // wave 1 before it releases a unit of its own — so a unit released while the
    // counter still reads 0 (which `spawnUnit` can do from the opening build
    // phase) takes wave 1's health, the lowest the scaling defines
    // (specs/instrumentation.md).
    const hp = scaledHp(def.baseHp, Math.max(1, this.wave), this.diff);
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
      prevX: c.x,
      prevY: c.y,
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
      frozen: false,
      dead: false,
    };
    u.route = this.board.routeFor(
      { x: u.x, y: u.y },
      u.wpIndex,
      this.occ,
      u.flies,
    );
    u.progress = this.remainingTiles(u);
    return u;
  }

  // ---- Re-path (specs/pathing.md) ---------------------------------------------
  // Rebuild the cached occupancy and re-route every walking unit from where it stands —
  // called whenever the maze changes (a rock placed, a combine freeing a footprint).
  private rePath(): void {
    this.occ = this.board.occupancy(this.structures);
    this.mazeCache = null; // the walls moved — the maze readout / overlay must recompute
    for (const u of this.units) {
      if (u.dead) continue;
      u.route = this.board.routeFor(
        { x: u.x, y: u.y },
        u.wpIndex,
        this.occ,
        u.flies,
      );
      u.routeStep = 0;
    }
    this.recomputeAuras();
  }

  // ---- Aura (specs/components.md) ---------------------------------------------
  // A Regulator (and some combination towers) projects a passive damage aura. Cache each
  // firing tower's total external aura bonus (sum of every aura source whose radius covers
  // its center, capped) so firing reads it cheaply. Recomputed whenever the maze changes and
  // at wave start. A tower does not buff itself.
  private recomputeAuras(): void {
    // Collect aura sources: any component whose OWN stats carry an aura radius.
    const sources: {
      x: number;
      y: number;
      r2: number;
      bonus: number;
      id: number;
    }[] = [];
    for (const s of this.structures) {
      if (s.kind !== "component") continue;
      const st = this.baseStatsOf(s);
      if (st.auraRadius > 0 && st.auraBonus > 0) {
        const ctr = footprintCenter(s.col, s.row);
        sources.push({
          x: ctr.x,
          y: ctr.y,
          r2: st.auraRadius * st.auraRadius,
          bonus: st.auraBonus,
          id: s.id,
        });
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
    return c.combo
      ? comboStats(c.combo, c.comboLevel)
      : deriveStats(c.type, c.tier);
  }

  // ---- The aura pulse (specs/assets.md) ---------------------------------------
  // The one of the twelve produced systems that is not tied to an event: it is played while
  // "a structure carrying an aura stands on the yard", "at its source". So nothing else in
  // the step raises it — each source runs a timer of its own and raises `fx/aura.json` at
  // its footprint whenever that timer comes round. A candidate carries no aura until it is
  // harvested, so only a component is a source, and a source is marked in a build phase
  // exactly as it is in a wave.
  private stepAuras(dt: number): void {
    for (const s of this.structures) {
      if (s.kind !== "component") continue;
      if (this.statsOf(s).auraRadius <= 0) {
        s.auraAnim = 0;
        continue;
      }
      s.auraAnim -= dt;
      if (s.auraAnim > 0) continue;
      s.auraAnim = AURA_PULSE_PERIOD;
      const ctr = footprintCenter(s.col, s.row);
      this.fxQueue.push({ kind: "aura", x: ctr.x, y: ctr.y });
    }
  }

  // ---- Component fire (specs/components.md) -----------------------------------
  private stepComponents(dt: number): void {
    for (const s of this.structures) {
      if (s.kind !== "component") continue;
      const c = s;
      c.fireAnim += dt;
      const stats = this.statsOf(c);
      if (!stats.fires) continue; // Regulator (and any non-firing node): aura only
      const center = footprintCenter(c.col, c.row);
      const targets = this.pickTargets(c, stats, center);
      if (targets.length > 0)
        c.aimAngle = Math.atan2(
          targets[0]!.y - center.y,
          targets[0]!.x - center.x,
        );
      c.cooldown -= dt;
      if (c.cooldown > 0 || targets.length === 0) continue;
      c.cooldown = 1 / stats.fireRate;
      c.fireAnim = 0;
      // A shot per target (multishot fires at up to `stats.multishot` distinct units at once).
      for (const t of targets) this.launchProjectile(c, stats, center, t);
      this.raiseCue(fireFamily(c));
    }
  }

  // The valid in-range units this component fires at this cadence, under its targeting
  // priority: one for a single-target tower, up to `stats.multishot` distinct units for a
  // multishot combo (each gets its own projectile).
  private pickTargets(
    c: Component,
    stats: CompStats,
    center: { x: number; y: number },
  ): Unit[] {
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
    inRange.sort((a, b) => this.rank(c.targeting, a, b, center));
    return inRange.slice(0, n);
  }

  // Order two in-range units under `mode`, best first (specs/components.md). A negative
  // result puts `a` first. Every priority breaks its ties toward the unit further along the
  // chain, so the choice is deterministic and does not depend on spawn order.
  private rank(
    mode: TargetingMode,
    a: Unit,
    b: Unit,
    center: { x: number; y: number },
  ): number {
    let primary = 0;
    switch (mode) {
      case "first":
        primary = -this.aheadOf(a, b);
        break;
      case "last":
        primary = this.aheadOf(a, b);
        break;
      case "nearest": {
        const da = this.dist2(a, center);
        const db = this.dist2(b, center);
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
    // The tie-break: the unit further along the chain wins.
    const ahead = this.aheadOf(a, b);
    if (ahead !== 0) return -ahead;
    return a.id - b.id;
  }

  private dist2(u: Unit, center: { x: number; y: number }): number {
    const dx = u.x - center.x;
    const dy = u.y - center.y;
    return dx * dx + dy * dy;
  }

  private launchProjectile(
    c: Component,
    stats: CompStats,
    center: { x: number; y: number },
    target: Unit,
  ): void {
    // Where the bolt is DRAWN from: the head, a little off the footprint's centre.
    // The projectile itself launches from the centre, as specs/components.md fixes.
    const muzzle = 16;
    const mx = center.x + Math.cos(c.aimAngle) * muzzle;
    const my = center.y + Math.sin(c.aimAngle) * muzzle;
    // Crit (combo-only): roll off the deterministic combat rng; a crit multiplies the shot.
    const isCrit =
      stats.critChance > 0 && this.combat.next() < stats.critChance;
    const dmg = isCrit ? stats.dmg * stats.critMult : stats.dmg;
    this.projectiles.push({
      id: this.nextId++,
      sourceId: c.id,
      type: c.type,
      tier: c.tier,
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
    // Muzzle glow at the head, plus the travelling bolt/spray FX for a single-bolt shot. A
    // chain (Coil) draws its arcs at impact and a splash (Arc-Node) its ring at impact, so
    // those emit no travelling-bolt FX here (specs/assets.md).
    // The travelling effect a shot carries (specs/assets.md): an Emitter throws its spark
    // spray, and every other single-bolt shot draws the arc bolt from the head to the
    // target. A Coil draws its chain at the impact and an Arc-Node its ring, so neither
    // trails a bolt on the way out.
    const family = fireFamily(c);
    if (family === "fire-spark") {
      this.fxQueue.push({
        kind: "spray",
        x: mx,
        y: my,
        x2: target.x,
        y2: target.y,
        tier: c.tier,
      });
    } else if (stats.chainLeaps === 0 && stats.splash === 0) {
      const big = stats.dmg >= 120;
      this.fxQueue.push({
        kind: "bolt",
        x: mx,
        y: my,
        x2: target.x,
        y2: target.y,
        tier: c.tier,
        big,
      });
    }
  }

  // ---- Projectiles in flight (specs/components.md) ----------------------------
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
      // The shot lands when it comes within PROJECTILE_HIT_R of its target's current
      // position, or when this step would carry it past that ring (specs/components.md).
      if (dist <= PROJECTILE_HIT_R || dist - step <= PROJECTILE_HIT_R) {
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
    this.fxQueue.push({
      kind: "impact",
      x: pr.x,
      y: pr.y,
      tier: pr.tier,
      big: pr.isCrit,
    });

    // Arc-Node: an expanding discharge ring dealing full damage to every unit in the splash
    // radius of the impact point (specs/components.md — the Arc-Node's splash).
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
    // dealing ×chainFalloff of the previous (specs/components.md — the Coil's chain).
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
        this.fxQueue.push({
          kind: "chain",
          x: fx,
          y: fy,
          x2: bestU.x,
          y2: bestU.y,
          tier: pr.tier,
        });
        this.hit(pr, bestU, dmg);
        this.fxQueue.push({
          kind: "impact",
          x: bestU.x,
          y: bestU.y,
          tier: pr.tier,
        });
        fx = bestU.x;
        fy = bestU.y;
        leaps--;
      }
    }
  }

  // Apply one landed shot to one unit (once), removing HP and killing it if it hits zero.
  // The damage and any kill are attributed back to the firing component for its inspector
  // tally (specs/components.md) via the projectile's sourceId.
  private hit(pr: Projectile, u: Unit, dmg: number): void {
    if (u.dead || pr.hitIds.includes(u.id)) return;
    pr.hitIds.push(u.id);
    u.hitFlash = 0;
    // The post-final Overload Dynamo cannot die: every shot's FULL damage is tallied into the
    // Maze Rating (specs/enemies.md, specs/campaign.md), and it still takes slow/burn so a maze that
    // controls it keeps it under fire longer — but its HP never falls and it is never killed.
    if (u.invincible) {
      this.tallyRating(dmg, pr.sourceId);
      if (pr.slowAmt > 0) this.applySlow(u, pr.slowAmt, pr.slowDur);
      if (pr.burnFrac > 0)
        this.applyBurn(u, pr.dmg * pr.burnFrac, pr.burnDur, pr.sourceId);
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
    // The unit survived: apply the shot's status effects (specs/components.md). A burn's DoT is a
    // fraction of the primary shot's damage, and attributes its ticks back to the firing tower.
    if (pr.slowAmt > 0) this.applySlow(u, pr.slowAmt, pr.slowDur);
    if (pr.burnFrac > 0)
      this.applyBurn(u, pr.dmg * pr.burnFrac, pr.burnDur, pr.sourceId);
  }

  // Credit damage dealt to the invincible finale boss: it adds to the run's MAZE RATING and to
  // the firing component's DMG-dealt tally (so the DMG board still ranks towers), and never
  // touches HP or a kill (specs/campaign.md).
  private tallyRating(dmg: number, srcId: number): void {
    this.mazeRating += dmg;
    const src = this.componentById(srcId);
    if (src) src.damageDealt += dmg;
  }

  // Slow (specs/enemies.md): a unit's effective speed becomes base × slowFactor while active.
  // The strongest active slow wins; each hit refreshes the duration.
  private applySlow(u: Unit, amt: number, dur: number): void {
    const activeFactor = this.simTime < u.slowUntil ? u.slowFactor : 1;
    u.slowFactor = Math.min(activeFactor, 1 - amt);
    u.slowUntil = this.simTime + dur;
    this.fxQueue.push({ kind: "slow", x: u.x, y: u.y });
    this.raiseCue("slow");
  }

  // Burn (specs/enemies.md): an overcurrent DoT ticking each step. Strongest burnDps wins; each
  // hit refreshes the duration. The ticks (in stepUnits) attribute to the applying tower.
  private applyBurn(u: Unit, dps: number, dur: number, srcId: number): void {
    const activeDps = this.simTime < u.burnUntil ? u.burnDps : 0;
    if (dps >= activeDps) {
      u.burnDps = dps;
      u.burnSourceId = srcId;
    }
    u.burnUntil = this.simTime + dur;
    this.fxQueue.push({ kind: "burn", x: u.x, y: u.y });
    this.raiseCue("burn");
  }

  private kill(u: Unit): void {
    u.dead = true;
    this.charge += u.bounty; // the kill bounty (there is no score — the Maze Rating is the score)
    this.kills++;
    this.fxQueue.push({
      kind: "death",
      x: u.x,
      y: u.y,
      big: u.type === "dynamo",
    });
    this.raiseCue("kill");
  }

  private unitById(id: number): Unit | null {
    for (const u of this.units) if (u.id === id) return u;
    return null;
  }

  private componentById(id: number): Component | null {
    for (const s of this.structures)
      if (s.id === id && s.kind === "component") return s;
    return null;
  }

  // ---- Movement / leaks (specs/pathing.md, specs/enemies.md) ------------------
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
        if (Math.floor(u.animT / 0.25) !== Math.floor((u.animT - dt) / 0.25))
          this.fxQueue.push({ kind: "burn", x: u.x, y: u.y });
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
      if (!u.frozen) this.moveUnit(u, dt);
      if (!u.dead) u.progress = this.remainingTiles(u);
    }
  }

  private moveUnit(u: Unit, dt: number): void {
    if (u.route.length === 0) {
      u.route = this.board.routeFor(
        { x: u.x, y: u.y },
        u.wpIndex,
        this.occ,
        u.flies,
      );
      u.routeStep = 0;
    }
    let budget = u.speed * u.slowFactor * dt; // slowed units cover less ground (specs/enemies.md)
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
      u.route = this.board.routeFor(
        { x: u.x, y: u.y },
        u.wpIndex,
        this.occ,
        u.flies,
      );
      u.routeStep = 0;
    }
  }

  // The remaining length of a unit's route to the checkpoint it is heading for, in tiles
  // (specs/instrumentation.md). Together with `wpIndex` it is the progress ordering of
  // specs/pathing.md, which `first` and `last` select on.
  private remainingTiles(u: Unit): number {
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

  // Is `a` further along the chain than `b` (specs/pathing.md)? The checkpoint index
  // dominates; among units heading for the same checkpoint the shorter remaining route is
  // further along. Returns 0 when the two stand at the same point on the chain.
  private aheadOf(a: Unit, b: Unit): number {
    if (a.wpIndex !== b.wpIndex) return a.wpIndex > b.wpIndex ? 1 : -1;
    if (a.progress !== b.progress) return a.progress < b.progress ? 1 : -1;
    return 0;
  }

  private leak(u: Unit): void {
    u.dead = true;
    const c = this.board.chain[this.board.chain.length - 1]!;
    const p = tileCenter(c.col, c.row);
    // The invincible finale boss grounding out ENDS the finale and wins the run — it costs no
    // integrity (the run is already won); its Maze Rating is already tallied (specs/campaign.md).
    if (u.invincible) {
      this.fxQueue.push({ kind: "leak", x: p.x, y: p.y });
      this.win();
      return;
    }
    this.integrity -= u.leak;
    this.leakCount += u.leak;
    this.fxQueue.push({ kind: "leak", x: p.x, y: p.y });
    this.raiseCue("leak");
  }

  private cullDead(): void {
    if (this.units.some((u) => u.dead))
      this.units = this.units.filter((u) => !u.dead);
    if (this.projectiles.some((p) => p.dead))
      this.projectiles = this.projectiles.filter((p) => !p.dead);
  }

  // ---- Wave flow (specs/campaign.md) ----------------------------------------------
  private checkWaveEnd(): void {
    const w = this.activeWave;
    if (!w) return;
    // The driver's hold is on this resolution and on nothing else: everything above has
    // already run, so structures fired, bounties were paid and leaks cost Grid Integrity
    // exactly as they do with the hold off (specs/instrumentation.md).
    if (this.waveHeld) return;
    if (this.spawnCursor >= w.events.length && this.units.length === 0)
      this.endWave();
  }

  private endWave(): void {
    this.activeWave = null;
    this.projectiles = [];
    // The wave's end takes the finale with it. A driver-released Overload Dynamo puts the
    // run into the finale while it is on the yard, and that wave clears the ordinary way, so
    // the phase it clears into is a build phase and not a finale nothing is walking
    // (specs/instrumentation.md). The real finale sets the flag again below.
    this.finale = false;
    // The bonus is a function of the wave number and of nothing else, so it is paid on
    // every wave the run clears, the last one included (specs/economy.md). Building stays
    // available during the finale, so it is Charge the player can still spend. There is NO
    // interest — Charge stays scarce.
    this.charge += waveClearBonus(this.wave);
    if (this.wave >= this.diff.waves) {
      // The final wave is cleared — the run is WON. Before the Victory screen, the post-final
      // invincible OVERLOAD DYNAMO walks the maze once so its total damage rates the maze
      // (specs/campaign.md). No build phase follows it.
      this.startFinale();
      return;
    }
    // Open the next (untimed) between-wave build phase and refresh the allowance.
    this.phase = "build";
    this.stampsUsed = 0; // the 5-stamp allowance refreshes at the start of the build phase
    this.harvest = { mode: "none" };
    this.holding = false;
    this.nextWave = buildWave(this.wave + 1, this.diff);
  }

  // Begin the post-final MAZE-RATING finale (specs/enemies.md, specs/campaign.md): spawn ONE
  // invincible Overload Dynamo at the Entry that walks the maze once. It cannot die — every
  // shot's full damage tallies into the Maze Rating (hit / tallyRating) — and when it grounds
  // out the run is won (leak → win). Building stays disabled (phase "wave"); the sim keeps
  // stepping with no more spawns (activeWave is null), so the boss simply walks and is shot.
  private startFinale(): void {
    this.finale = true;
    this.phase = "wave";
    this.selectedId = null;
    this.combineIds = [];
    const u = this.makeUnit("dynamo");
    u.invincible = true;
    u.maxHp = u.hp; // display only — the invincible boss's HP never falls
    u.radius = 28; // a larger, looming overload core
    u.speed = OVERLOAD_SPEED; // a brisk, dramatic single walk (not the slow campaign Dynamo)
    this.units = [u];
    this.recomputeAuras();
  }

  // Resolve the level's harvest (keep / combine) and start the wave (specs/scrap-press.md,
  // specs/campaign.md). The kept candidate becomes a firing component; every un-harvested
  // candidate hardens into a blocker.
  private beginWave(): void {
    this.resolveHarvest();
    this.wave += 1;
    this.phase = "wave";
    this.paused = false;
    this.holding = false;
    this.activeWave = this.nextWave;
    this.spawnerHeld = false;
    this.spawnCursor = 0;
    this.waveClock = 0;
    this.occ = this.board.occupancy(this.structures);
    this.mazeCache = null; // the harvest changed the walls (kept/consumed footprints)
    this.recomputeAuras(); // the harvest may have added an aura source / a buffable tower
    this.nextWave = buildWave(
      Math.min(this.wave + 1, this.diff.waves),
      this.diff,
    );
  }

  // Resolve this level's KEEP (specs/scrap-press.md): promote the one kept candidate to a permanent
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
        this.structures[i] = {
          id: s.id,
          kind: "blocker",
          col: s.col,
          row: s.row,
        } as Blocker;
        hardened = true;
      }
    }
    if (hardened) this.raiseCue("settle");
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
      auraAnim: 0,
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

  // IMMEDIATE quality-combine (specs/scrap-press.md): fold `anchorId` and `partnerId` — two base
  // structures of the SAME type + quality (each a candidate OR an existing component) — into one
  // component a tier higher, landing at the ANCHOR's footprint (so a combine can REPLACE an
  // existing tower, triggered from any tower in the set). The partner is consumed but its 2×2
  // footprint HARDENS INTO A BLOCKER so the maze wall is preserved (a combine never opens a
  // hole). Runs the instant it is committed — build phase OR live wave — and re-paths. Returns
  // true if it resolved.
  private combineQualityNow(anchorId: number, partnerId: number): boolean {
    if (this.state !== "playing") return false;
    const anchor = this.baseStructById(anchorId);
    const partner = this.baseStructById(partnerId);
    if (!anchor || !partner || anchor.id === partner.id) return false;
    if (
      anchor.tier >= MAX_TIER ||
      partner.type !== anchor.type ||
      partner.tier !== anchor.tier
    )
      return false;
    // A combine that folds in any candidate placed THIS build phase consumes the phase's roll —
    // it is the harvest, so it ends the build phase and launches the wave (specs/scrap-press.md).
    const consumedFreshRoll =
      anchor.kind === "candidate" || partner.kind === "candidate";
    const newTier = (anchor.tier + 1) as Tier;
    const pIdx = this.structures.findIndex((s) => s.id === partner.id);
    if (pIdx >= 0)
      this.structures[pIdx] = {
        id: partner.id,
        kind: "blocker",
        col: partner.col,
        row: partner.row,
      } as Blocker;
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
      auraAnim: 0,
      aimAngle: 0,
      kills: 0,
      damageDealt: 0,
      auraBonus: 0,
    };
    if (i >= 0) this.structures[i] = comp;
    else this.structures.push(comp);
    this.selectedId = comp.id;
    this.combineIds = [comp.id];
    this.rePath();
    const ctr = footprintCenter(comp.col, comp.row);
    this.fxQueue.push({ kind: "combine", x: ctr.x, y: ctr.y, tier: comp.tier });
    this.raiseCue("combine");
    // A fresh-roll combine (COMBINE SPECIAL) is the phase's SOLE harvest: it discards any marked
    // KEEP (only one new tower a phase, specs/scrap-press.md) and sends the wave.
    if (consumedFreshRoll && this.phase === "build") {
      this.harvest = { mode: "none" };
      this.beginWave();
    }
    return true;
  }

  // IMMEDIATE recipe-combine (specs/scrap-press.md, specs/combinations.md): fold `ingredientIds` (base
  // structures — candidates and/or existing base components — whose (type, tier) multiset
  // exactly matches `combo`'s recipe) into the combination tower `combo`, landing at `anchorId`
  // (which must be one of the ingredients). Every OTHER consumed ingredient HARDENS INTO A
  // BLOCKER in place (wall-neutral). Runs the instant it is committed — build phase OR live wave
  // — and re-paths. A combo lands at UPGRADE LEVEL 0 (the reduced landing block,
  // specs/combinations.md).
  private combineRecipeNow(
    anchorId: number,
    combo: ComboType,
    ingredientIds: number[],
  ): boolean {
    if (this.state !== "playing") return false;
    const anchor = this.baseStructById(anchorId);
    if (!anchor || !ingredientIds.includes(anchorId)) return false;
    if (!this.recipeSatisfied(combo, ingredientIds)) return false;
    // Folding in any candidate placed THIS build phase consumes the phase's roll (specs/scrap-press.md):
    // the combine is the harvest, so it ends the build phase and launches the wave.
    const consumedFreshRoll = ingredientIds.some(
      (iid) => this.candidateById(iid) !== null,
    );
    for (const iid of ingredientIds) {
      if (iid === anchor.id) continue;
      const pIdx = this.structures.findIndex((s) => s.id === iid);
      if (pIdx >= 0) {
        const p = this.structures[pIdx]!;
        this.structures[pIdx] = {
          id: p.id,
          kind: "blocker",
          col: p.col,
          row: p.row,
        } as Blocker;
      }
    }
    const i = this.structures.findIndex((s) => s.id === anchor.id);
    const comp: Component = {
      id: anchor.id,
      kind: "component",
      type: anchor.type, // an ingredient type, drives the base tint only
      tier: MAX_TIER, // sentinel; a combo's power axis is its comboLevel, not tier
      combo,
      // lands WEAK (specs/combinations.md — half its reference damage); upgrade to climb it
      comboLevel: 0,
      col: anchor.col,
      row: anchor.row,
      targeting: "first",
      cooldown: 0,
      fireAnim: 999,
      auraAnim: 0,
      aimAngle: 0,
      kills: 0,
      damageDealt: 0,
      auraBonus: 0,
    };
    if (i >= 0) this.structures[i] = comp;
    else this.structures.push(comp);
    this.selectedId = comp.id;
    this.combineIds = [comp.id];
    this.rePath();
    const ctr = footprintCenter(comp.col, comp.row);
    this.fxQueue.push({
      kind: "combine",
      x: ctr.x,
      y: ctr.y,
      tier: MAX_TIER,
      big: true,
    });
    this.raiseCue("combine");
    // A fresh-roll combine (COMBINE SPECIAL) is the phase's SOLE harvest: it discards any marked
    // KEEP (only one new tower a phase, specs/scrap-press.md) and sends the wave.
    if (consumedFreshRoll && this.phase === "build") {
      this.harvest = { mode: "none" };
      this.beginWave();
    }
    return true;
  }

  private win(): void {
    // Victory: the Maze Rating is already tallied over the finale (specs/campaign.md). Integrity
    // decided win/lose only — it adds nothing to the rating.
    this.finale = false;
    this.state = "victory";
    this.units = [];
    this.projectiles = [];
  }

  private lose(): void {
    this.integrity = 0;
    this.finale = false;
    this.state = "overload";
    this.units = [];
    this.projectiles = [];
    this.activeWave = null;
  }

  // ---- The scrap-press build loop (specs/scrap-press.md) ----------------------

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

  // Pull the press: arm a BLANK rock on the cursor (specs/scrap-press.md). No roll yet — the roll
  // happens when the rock lands (placeStamp). Placement is free. Returns true if armed.
  pullPress(): boolean {
    if (!this.canStamp()) return false;
    this.holding = true;
    this.raiseCue("stamp");
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

  // Quality roll biased by the current Refinement level (specs/scrap-press.md — Refinement).
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
  // a blocker rerolls it into a fresh candidate (specs/scrap-press.md).
  private blockerAtAnchor(col: number, row: number): Blocker | null {
    for (const s of this.structures) {
      if (s.kind === "blocker" && s.col === col && s.row === row) return s;
    }
    return null;
  }

  // Where a rock may land: an empty legal footprint, OR exactly onto an existing blocker
  // (which it rerolls). specs/scrap-press.md, specs/yard.md.
  canPlaceAt(col: number, row: number): boolean {
    if (this.state !== "playing" || this.phase !== "build") return false;
    if (this.blockerAtAnchor(col, row)) return true;
    return this.board.canPlace(col, row, this.structures, this.units);
  }

  // Drop a rock at the 2×2 anchor (col, row): the roll happens HERE (a random type + quality
  // on the current Refinement odds), spending one stamp of the level's allowance and landing a
  // CANDIDATE that walls and re-paths the floor (specs/scrap-press.md, specs/yard.md). Placement is
  // FREE — no Charge. Dropping onto a blocker rerolls it in place. Returns the placed candidate,
  // or null if refused. Re-arms another rock afterward if the allowance still permits (continuous
  // placement). If no rock is held (the headless one-shot path), it arms one implicitly.
  placeStamp(col: number, row: number): Candidate | null {
    if (this.state !== "playing" || this.phase !== "build") return null;
    if (!this.holding && !this.canStamp()) return null;
    // No allowance left and not currently holding: refuse.
    if (this.stampsLeft() <= 0) return null;
    const onBlocker = this.blockerAtAnchor(col, row);
    if (
      !onBlocker &&
      !this.board.canPlace(col, row, this.structures, this.units)
    ) {
      return null; // illegal spot: keep holding, nothing spent
    }
    if (onBlocker) {
      // Reroll a blocker in place: remove it, drop a candidate on the same footprint.
      this.structures = this.structures.filter((s) => s.id !== onBlocker.id);
    }
    this.stampsUsed += 1;
    // The roll happens on the drop: from the seeded press, OR the exact value armed by the
    // debug API's setNextRoll (a one-shot override that then clears, specs/instrumentation.md).
    const armed = this.armedRoll;
    this.armedRoll = null;
    const cand: Candidate = {
      id: this.nextId++,
      kind: "candidate",
      type: armed ? armed.type : this.rollType(),
      tier: armed ? armed.tier : this.rollTier(),
      col,
      row,
    };
    this.structures.push(cand);
    this.selectedId = cand.id;
    this.combineIds = [cand.id];
    // Continuous placement (specs/scrap-press.md): release the placed rock, then immediately re-arm
    // another if the allowance still permits. canStamp() requires !holding, so holding MUST be
    // cleared first — otherwise it always reads false and the hand empties after one drop.
    this.holding = false;
    this.holding = this.canStamp();
    this.rePath();
    const ctr = footprintCenter(col, row);
    this.fxQueue.push({ kind: "build", x: ctr.x, y: ctr.y, tier: cand.tier });
    this.raiseCue("stamp");
    return cand;
  }

  cancelHeld(): void {
    this.holding = false; // nothing was rolled or spent — cancelling a held rock is free
  }

  // ---- Dismantle (specs/scrap-press.md) — remove a misplaced structure -------
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
    if (this.harvest.mode === "keep" && this.harvest.id === id)
      this.harvest = { mode: "none" };
    this.structures.splice(i, 1);
    if (this.selectedId === id) this.selectedId = null;
    const si = this.combineIds.indexOf(id);
    if (si >= 0) this.combineIds.splice(si, 1);
    this.rePath();
    return true;
  }
  removeSelected(): void {
    if (this.selectedId != null) this.removeStructure(this.selectedId);
  }

  // ---- Keep (the one harvest) + IMMEDIATE combining (specs/scrap-press.md) ---
  // KEEP is the level's single harvest — committing it IMMEDIATELY launches the wave (one
  // candidate → a permanent firing component; the rest harden into blockers). There is no SEND and
  // no reversible keep. COMBINING is separate: it is IMMEDIATE and may be done as often as
  // ingredients allow, in the build phase AND during a live wave — a fresh-consuming combine is
  // itself the harvest (and launches the wave), while a standing-only combine climbs the quality
  // ladder / builds the combo roster without ending the phase (specs/scrap-press.md, specs/controls.md).

  candidateById(id: number): Candidate | null {
    const s = this.structures.find((x) => x.id === id);
    return s && s.kind === "candidate" ? s : null;
  }
  candidates(): Candidate[] {
    return this.structures.filter(
      (s): s is Candidate => s.kind === "candidate",
    );
  }

  // KEEP the selected candidate as this level's harvest — and, because a harvest IS the wave
  // trigger (there is no SEND button, specs/scrap-press.md, specs/hud.md), it **immediately launches
  // the wave**: the candidate becomes a permanent firing component and every other candidate
  // hardens into a blocker. There is no reversible/deferred keep — place and compare all rocks
  // first, then commit the one you want. Every level must harvest to advance (specs/scrap-press.md).
  keep(id: number): void {
    // A control the player operates is refused wherever that control is refused, and the
    // pause menu takes the input: on `paused` every control on the yard is inert
    // (specs/controls.md).
    if (this.state !== "playing") return;
    if (this.phase !== "build") return;
    if (!this.candidateById(id)) return;
    this.harvest = { mode: "keep", id };
    this.beginWave();
  }
  keepSelected(): void {
    const s = this.selected();
    if (s && s.kind === "candidate") this.keep(s.id);
  }

  // Does a same-type + same-quality match exist for this base structure (another candidate or an
  // existing base component), so a quality-COMBINE is offered? Tesla-Prime never combines, and a
  // combination tower / blocker is never a base structure (specs/scrap-press.md).
  canCombine(c: Candidate | Component): boolean {
    return c.tier < MAX_TIER && this.combinePartnerOf(c) !== null;
  }
  // Auto-picks a partner, PRIORITIZING a fresh candidate over a standing component
  // (specs/scrap-press.md):
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
    for (const id of this.combineIds) push(id);
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
    // An emptied set is no explicit set, so the ingredients are the game's to resolve
    // from whatever is selected (specs/scrap-press.md).
    const anchor = set.length > 0 ? set[0]! : this.selectedId;
    if (anchor === null) return false;
    if (set.length >= 2) {
      // Explicit set: try a quality pair, then a recipe multiset that this exact set satisfies.
      if (set.length === 2) {
        const a = this.baseStructById(set[0]!)!;
        const b = this.baseStructById(set[1]!)!;
        if (a.tier < MAX_TIER && a.type === b.type && a.tier === b.tier)
          return this.combineQualityNow(anchor, set[1]!);
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
    if (recipes.length >= 1)
      return this.combineRecipeNow(
        anchor,
        recipes[0]!.combo,
        recipes[0]!.ingredientIds,
      );
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
  // multiset must equal a recipe's, with every id a valid base structure (specs/combinations.md).
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
    for (const combo of COMBO_ORDER)
      if (recipeKey(COMBOS[combo].recipe) === key) return combo;
    return null;
  }

  // ---- Recipe combine — assemble a combination tower ------------------------
  // (specs/scrap-press.md, specs/combinations.md)
  // The board's INGREDIENT pool: candidates and base components (not blockers, not existing
  // combos — combos are terminal and cannot be ingredients). Each contributes its (type,tier).
  private ingredientKeyOf(s: Structure): string | null {
    if (s.kind === "candidate") return `${s.type}@${s.tier}`;
    if (s.kind === "component" && !s.combo) return `${s.type}@${s.tier}`;
    return null;
  }

  // Every combination-tower recipe the board can satisfy INCLUDING `anchor` (a candidate OR an
  // existing base component) as one ingredient, each with a concrete set of ingredient ids (the
  // anchor first). Used by the inspector to offer COMBINE SPECIAL → <combo> and by dev drivers. Auto-
  // picks the remaining ingredients; an explicit multi-select can override which copies (below).
  reachableCombos(
    anchor: Candidate | Component,
  ): { combo: ComboType; ingredientIds: number[] }[] {
    const anchorKey = `${anchor.type}@${anchor.tier}`;
    const avail = new Map<string, number[]>();
    for (const s of this.structures) {
      const k = this.ingredientKeyOf(s);
      if (!k) continue;
      if (!avail.has(k)) avail.set(k, []);
      avail.get(k)!.push(s.id);
    }
    // Auto-pick prioritizes CONSUMING fresh candidates over standing components (specs/scrap-press.md):
    // sort each ingredient pool candidate-first so an un-targeted recipe spends this phase's rolls
    // (→ COMBINE SPECIAL, ends the phase) before eating invested towers.
    for (const list of avail.values()) {
      list.sort(
        (a, b) =>
          (this.candidateById(b) ? 1 : 0) - (this.candidateById(a) ? 1 : 0),
      );
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
        if (k === anchorKey)
          list = [anchor.id, ...list.filter((id) => id !== anchor.id)]; // spend THIS anchor
        for (let i = 0; i < c; i++) ids.push(list[i]!);
      }
      out.push({ combo, ingredientIds: ids });
    }
    return out;
  }

  // Convenience for the UI: the reachable combos for a structure id (empty unless it is a base
  // structure — a candidate or a base component).
  reachableCombosFor(
    id: number,
  ): { combo: ComboType; ingredientIds: number[] }[] {
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
    return this.selectedId != null
      ? this.combineRecipe(this.selectedId, combo)
      : false;
  }

  // ---- UPGRADE QUALITY — the Refinement track (specs/scrap-press.md) -----------

  refineCost(): number | null {
    return nextRefineCost(this.refinement);
  }
  canUpgradeQuality(): boolean {
    // Refining the press is allowed in ANY phase (specs/scrap-press.md): it only biases FUTURE rolls,
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
    return true;
  }

  // ---- DOWNGRADE a candidate — KEEP it one tier lower (specs/scrap-press.md) ----
  // Refining the press biases rolls UP, which can leave a player unable to produce a LOW-tier
  // ingredient a recipe still needs. DOWNGRADE fixes that: it is a **KEEP at one quality tier
  // lower** — it harvests the selected CANDIDATE (a rock placed this phase) as a permanent
  // firing component at (tier − 1), FREE, and — because it is the level's harvest — it LAUNCHES
  // the wave (like KEEP). To use the lowered tower as a recipe ingredient, fold it with a
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
    this.fxQueue.push({ kind: "build", x: ctr.x, y: ctr.y, tier: cand.tier });
    // DOWNGRADE is a KEEP at the lowered tier: it is the level's harvest, so it launches the wave.
    this.harvest = { mode: "keep", id };
    this.beginWave();
    return true;
  }
  downgradeSelected(): void {
    if (this.selectedId != null) this.downgrade(this.selectedId);
  }

  // ---- UPGRADE a combination tower (specs/combinations.md) ---------------------
  // A combo lands at level 0 (weakened) and CLIMBS with Charge — the softened spike + gold sink.
  // Allowed in ANY phase (specs/combinations.md), up to MAX_COMBO_LEVEL; each level
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
    if (comboStats(s.combo!, s.comboLevel).auraRadius > 0)
      this.recomputeAuras();
    this.raiseCue("combine");
    const ctr = footprintCenter(s.col, s.row);
    this.fxQueue.push({
      kind: "combine",
      x: ctr.x,
      y: ctr.y,
      tier: MAX_TIER,
      big: true,
    });
    return true;
  }
  upgradeComboSelected(): void {
    if (this.selectedId != null) this.upgradeCombo(this.selectedId);
  }

  // ---- Targeting (specs/components.md, specs/controls.md) ---------------------

  setTargeting(c: Component, mode: TargetingMode): void {
    c.targeting = mode;
  }
  cycleTargeting(c: Component): void {
    const i = TARGETING_ORDER.indexOf(c.targeting);
    c.targeting = TARGETING_ORDER[(i + 1) % TARGETING_ORDER.length]!;
  }
  cycleTargetingSelected(): void {
    if (this.state !== "playing") return;
    const s = this.selected();
    if (s && s.kind === "component") this.cycleTargeting(s);
  }

  // ---- Selection (single + explicit multi-select for combining) ---------------

  select(id: number | null): void {
    this.selectedId = id;
    // A plain select clears the combine set back to that single selection
    // (specs/instrumentation.md), and clearing the selection empties it.
    this.combineIds = id === null ? [] : [id];
  }
  // Plain select (clears the multi-select) or, with `additive` (shift-click), TOGGLE a structure
  // in the explicit combine set (specs/controls.md). The primary stays the inspector target; the
  // additive ids are the extra copies a combine will fold. Only base structures add to the set.
  selectAt(x: number, y: number, additive = false): void {
    const s = this.structureAt(x, y);
    if (!additive) {
      this.selectedId = s ? s.id : null;
      this.combineIds = s ? [s.id] : [];
      return;
    }
    if (!s) return;
    if (this.selectedId == null) {
      this.selectedId = s.id;
      this.combineIds = [s.id];
      return;
    }
    if (s.id === this.selectedId) return; // shift-clicking the primary is a no-op
    const i = this.combineIds.indexOf(s.id);
    if (i >= 0) this.combineIds.splice(i, 1);
    else if (this.baseStructById(s.id)) this.combineIds.push(s.id);
  }
  structureAt(x: number, y: number): Structure | null {
    const t = this.board.pixelToTile(x, y);
    for (const s of this.structures) {
      if (
        t.col >= s.col &&
        t.col <= s.col + 1 &&
        t.row >= s.row &&
        t.row <= s.row + 1
      )
        return s;
    }
    return null;
  }
  selected(): Structure | null {
    return this.selectedId != null
      ? (this.structures.find((s) => s.id === this.selectedId) ?? null)
      : null;
  }
  // The extra multi-selected structures (excluding the primary) that still exist, for rendering.
  extraSelected(): Structure[] {
    const out: Structure[] = [];
    for (const id of this.combineIds) {
      if (id === this.selectedId) continue;
      const s = this.structures.find((x) => x.id === id);
      if (s) out.push(s);
    }
    return out;
  }

  // ---- Wave control (specs/campaign.md, specs/controls.md) ------------------------
  // There is NO player SEND: a wave starts when the level's HARVEST is committed — a KEEP or a
  // fresh-consuming COMBINE (which call beginWave themselves). Every level must harvest to
  // advance (specs/scrap-press.md), so no separate start action is surfaced to the player. startWave()
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

  // ---- Maze length (specs/pathing.md, specs/hud.md) ---------------------------
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

  // ---- Combine highlight (specs/scrap-press.md, specs/controls.md) ------------
  // The structures that will FOLD TOGETHER if the player combines now, so the renderer pulses
  // them and the player sees exactly what folds. With an EXPLICIT multi-select (≥2 base
  // structures), those exact pieces are marked as "committed" (the precise set a combine folds).
  // With a lone base selection, every eligible partner it COULD fold with is marked (its
  // quality-combine match plus every reachable combination-tower ingredient). Combining is
  // immediate, so there is no deferred harvest to reflect — this is purely the live selection.
  combineHighlight(): {
    primaryId: number | null;
    partnerIds: Set<number>;
    committed: boolean;
  } {
    const partnerIds = new Set<number>();
    const set = this.combineSet();
    if (set.length >= 2) {
      for (let i = 1; i < set.length; i++) partnerIds.add(set[i]!);
      return { primaryId: set[0]!, partnerIds, committed: true };
    }
    const sel = this.selected();
    if (
      sel &&
      (sel.kind === "candidate" || (sel.kind === "component" && !sel.combo))
    ) {
      const qp = this.combinePartnerOf(sel);
      if (qp) partnerIds.add(qp.id);
      for (const rec of this.reachableCombos(sel)) {
        for (const id of rec.ingredientIds)
          if (id !== sel.id) partnerIds.add(id);
      }
      return { primaryId: sel.id, partnerIds, committed: false };
    }
    return { primaryId: null, partnerIds, committed: false };
  }

  // Every base structure that could fold into SOME combine right now — a quality pair or a
  // reachable combination-tower recipe (specs/scrap-press.md). The renderer pulses these AT ALL TIMES
  // (not only when one is selected) so the player is told, unprompted, that combines are available
  // and exactly which pieces can fold. A piece with no partner and no reachable recipe is omitted.
  combinablePieces(): Set<number> {
    const ids = new Set<number>();
    for (const s of this.structures) {
      if (s.kind !== "candidate" && !(s.kind === "component" && !s.combo))
        continue;
      const base = s as Candidate | Component;
      if (
        this.combinePartnerOf(base) !== null ||
        this.reachableCombos(base).length > 0
      )
        ids.add(base.id);
    }
    return ids;
  }

  // ---- Speed / pause (specs/controls.md) --------------------------------------

  cycleSpeed(): void {
    // 1× → 2× → 4× → 8× → 1× (specs/controls.md). The fixed-timestep loop substeps, so a
    // higher speed just runs more fixed ticks per frame — the sim stays stable at 8×.
    this.speed =
      this.speed === 1 ? 2 : this.speed === 2 ? 4 : this.speed === 4 ? 8 : 1;
  }
  togglePause(): void {
    if (this.state === "playing") this.paused = !this.paused;
  }

  // ---- Queries ----------------------------------------------------------------

  // A component's live stats INCLUDING its cached external aura buff (specs/components.md). A
  // combination tower reads its fixed block; a base component derives from (type, tier).
  statsOf(c: Component): CompStats {
    const st = this.baseStatsOf(c);
    // An aura-buffed damage figure is NOT rounded (specs/components.md): the buff multiplies
    // the structure's per-shot damage and the product carries its fraction into the hit.
    if (c.auraBonus > 0 && st.dmg > 0)
      return { ...st, dmg: st.dmg * (1 + c.auraBonus) };
    return st;
  }

  // ---- The debug and automation surface (specs/instrumentation.md) ------------
  // The operations `window.__foundry` exposes reduce to the methods below. Each is atomic:
  // it sets one field, reads one value, or commits one control, and leaves the rest of the
  // game as it stands. A pose arranges the yard through the systems play itself uses — a
  // placed rock rolls through the real press, a harvested candidate becomes a component
  // through the real harvest, a released unit walks the real pathfinder — so what happens
  // next comes from advancing the real simulation and never from the pose.
  //
  // An argument outside the domain an operation states throws; a control a player operates
  // is REFUSED rather than throwing, wherever the control itself would be refused.

  // Return the game to its title state and reseed every random draw. The mute bit and the
  // pointer are deliberately untouched: both belong to the runtime layer rather than to the
  // game (specs/instrumentation.md).
  debugReset(seed: number = DEFAULT_SEED): void {
    this.pressSeed = seed >>> 0;
    this.map = DEFAULT_MAP;
    this.board = new Board(this.map);
    this.diff = DIFFICULTY.medium;
    this.state = "title";
    this.phase = "build";
    this.menuIndex = 0;
    this.paused = false;
    this.charge = START_CHARGE;
    this.integrity = START_INTEGRITY;
    this.maxIntegrity = START_INTEGRITY;
    this.mazeRating = 0;
    this.finale = false;
    this.wave = 0;
    this.speed = 1;
    this.units = [];
    this.projectiles = [];
    this.structures = [];
    this.holding = false;
    this.selectedId = null;
    this.combineIds = [];
    this.stampsUsed = 0;
    this.refinement = 0;
    this.harvest = { mode: "none" };
    this.kills = 0;
    this.leakCount = 0;
    this.armedRoll = null;
    this.uiCombos = false;
    this.uiBoard = false;
    this.fxQueue = [];
    this.sndQueue = [];
    this.cuesThisStep.clear();
    this.activeWave = null;
    this.spawnerHeld = false;
    this.waveHeld = false;
    this.spawnCursor = 0;
    this.waveClock = 0;
    this.simTime = 0;
    this.nextId = 1;
    this.press = new Rng(this.pressSeed);
    this.combat = new Rng((this.pressSeed ^ COMBAT_SEED) >>> 0);
    this.nextWave = buildWave(1, this.diff);
    this.occ = this.board.occupancy([]);
    this.mazeCache = null;
  }

  // ---- The run -----------------------------------------------------------------

  // The map the next run opens on. Setting it rebuilds the board, so the chain a snapshot
  // reports is the chosen map's from this moment.
  setMap(map: MapDef): void {
    this.map = map;
    this.board = new Board(map);
    this.occ = this.board.occupancy(this.structures);
    this.mazeCache = null;
  }

  setDifficulty(diff: DifficultyDef): void {
    this.diff = diff;
    this.nextWave = buildWave(Math.max(1, this.wave + 1), this.diff);
  }

  // Enter a run on the current map at the current difficulty, opening it on its first build
  // phase with the allocation specs/campaign.md states. This is the path confirming the
  // difficulty select takes. It never reseeds: every random draw runs off the generator
  // reset seeded, and nothing else seeds it (specs/instrumentation.md).
  startRun(): void {
    this.startOn(this.map, this.diff);
  }

  // Move to a named screen, as reaching it in play does. The eight identifiers are
  // specs/ui.md's.
  //
  // "A menu reached other than by returning to it opens with its first entry
  // highlighted, at menu index 0. Returning to a menu highlights the entry that led
  // away from it" (specs/ui.md), so the default is the first entry and a caller
  // returning to a menu names the entry it came through.
  setScreen(screen: GameState, index = 0): void {
    this.state = screen;
    this.menuIndex = index;
  }

  setMenuIndex(index: number): void {
    this.menuIndex = index;
  }

  // Move the run between its three phases and do nothing else (specs/instrumentation.md).
  // "wave" opens a live wave whose spawn schedule is empty, exactly as a driver-released
  // unit does, so the yard holds whatever it already held; "build" ends whatever phase is
  // running without paying a bonus and without advancing the counter; "finale" opens the
  // maze-rating finale over the units already walking. It spends no wave number.
  setPhase(phase: "build" | "wave" | "finale"): void {
    if (phase === "build") {
      this.activeWave = null;
      this.spawnerHeld = false;
      this.spawnCursor = 0;
      this.waveClock = 0;
      this.finale = false;
      this.phase = "build";
      this.harvest = { mode: "none" };
      return;
    }
    this.finale = phase === "finale";
    this.phase = "wave";
    this.holdSpawner();
  }

  // Hold the running wave's own clear-and-pay resolution, or release it.
  setWaveHold(held: boolean): void {
    this.waveHeld = held;
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
  }

  setSpeed(multiplier: 1 | 2 | 4 | 8): void {
    this.speed = multiplier;
  }

  setOverlay(overlay: "combos" | "damage", open: boolean): void {
    if (overlay === "combos") this.uiCombos = open;
    else this.uiBoard = open;
  }

  // ---- Resources and progress ---------------------------------------------------

  setCharge(amount: number): void {
    this.charge = amount;
  }

  // Set Grid Integrity. It resolves no defeat by itself; the game's own rules resolve on the
  // next advance (specs/instrumentation.md).
  setIntegrity(amount: number): void {
    this.integrity = amount;
    this.maxIntegrity = Math.max(this.maxIntegrity, amount);
  }

  setRefinement(level: Refinement): void {
    this.refinement = level;
  }

  // Set the current wave number, so units released from now on scale to it. The scaling is
  // defined from wave 1, so a 0 scales as wave 1 (specs/enemies.md).
  setWave(n: number): void {
    this.wave = n;
    this.nextWave = buildWave(
      Math.max(1, Math.min(n + 1, this.diff.waves)),
      this.diff,
    );
  }

  setStamps(n: number): void {
    this.stampsUsed = BUILDS_PER_LEVEL - n;
  }

  // ---- Structures ---------------------------------------------------------------

  // Remove every candidate, component, combination tower, and blocker, reopen their tiles,
  // clear the selection and the combine set, and recompute the route.
  clearStructures(): void {
    this.structures = [];
    this.selectedId = null;
    this.combineIds = [];
    this.harvest = { mode: "none" };
    this.rePath();
  }

  // Arm the exact component the next placed rock rolls; the rock still enters through the
  // real placement path. The arming survives until a rock consumes it or it is cleared.
  armNextRoll(type: ComponentType, quality: Tier): void {
    this.armedRoll = { type, tier: quality };
  }

  clearNextRoll(): void {
    this.armedRoll = null;
  }

  // Stand a permanent firing component up at an anchor, at that type and quality. It spends
  // no stamp, consumes no harvest, costs no Charge, and starts no wave; it is subject to the
  // placement conditions of specs/yard.md and the never-seal rule of specs/pathing.md, and is
  // refused when either fails. Available in every phase.
  placeComponent(
    type: ComponentType,
    quality: Tier,
    col: number,
    row: number,
  ): Component | null {
    if (!this.board.canPlace(col, row, this.structures, this.units))
      return null;
    const comp: Component = {
      id: this.nextId++,
      kind: "component",
      type,
      tier: quality,
      comboLevel: 0,
      col,
      row,
      targeting: "first",
      cooldown: 0,
      fireAnim: 999,
      auraAnim: 0,
      aimAngle: 0,
      kills: 0,
      damageDealt: 0,
      auraBonus: 0,
    };
    this.structures.push(comp);
    this.rePath();
    return comp;
  }

  // Stand a combination tower up at an anchor, at upgrade level 0. Same conditions as
  // placeComponent.
  placeCombo(combo: ComboType, col: number, row: number): Component | null {
    if (!this.board.canPlace(col, row, this.structures, this.units))
      return null;
    const comp: Component = {
      id: this.nextId++,
      kind: "component",
      type: COMBOS[combo].recipe[0]!.type,
      tier: MAX_TIER,
      combo,
      comboLevel: 0,
      col,
      row,
      targeting: "first",
      cooldown: 0,
      fireAnim: 999,
      auraAnim: 0,
      aimAngle: 0,
      kills: 0,
      damageDealt: 0,
      auraBonus: 0,
    };
    this.structures.push(comp);
    this.rePath();
    return comp;
  }

  // Stand an inert blocker up at an anchor. Same conditions as placeComponent.
  placeBlocker(col: number, row: number): Blocker | null {
    if (!this.board.canPlace(col, row, this.structures, this.units))
      return null;
    const b: Blocker = { id: this.nextId++, kind: "blocker", col, row };
    this.structures.push(b);
    this.rePath();
    return b;
  }

  // Add one base structure to the explicit combine set, or remove it when it is already in
  // the set, as a press on it with `modify` held would (specs/controls.md).
  addToCombineSet(id: number): void {
    if (this.selectedId === null) {
      this.selectedId = id;
      this.combineIds = [id];
      return;
    }
    if (this.selectedId === id) return;
    const at = this.combineIds.indexOf(id);
    if (at >= 0) this.combineIds.splice(at, 1);
    else this.combineIds.push(id);
  }

  // Empty the explicit combine set, leaving the selection as it is (specs/instrumentation.md).
  clearCombineSet(): void {
    this.combineIds = [];
  }

  // Set a combination tower's upgrade level, and with it the damage and range that level
  // gives. It spends no Charge.
  setComboLevel(id: number, level: number): void {
    const c = this.componentById(id);
    if (c) c.comboLevel = level;
  }

  // A firing structure's targeting priority.
  debugSetTargeting(id: number, mode: TargetingMode): void {
    if (this.state !== "playing") return;
    const c = this.componentById(id);
    if (c) this.setTargeting(c, mode);
  }

  // Commit a combine from an initiating structure, as specs/scrap-press.md states: with an
  // explicit combine set, exactly that set; with none, the ingredients the game resolves
  // itself, preferring a candidate over a standing structure.
  debugCombine(id: number): boolean {
    const set = this.combineSet();
    if (set.length >= 2 && set[0] === id) return this.combineSelection();
    this.select(id);
    return this.combineSelection();
  }

  // ---- The Load -----------------------------------------------------------------

  // Remove every live unit. None is killed and none leaks, so no bounty is paid and no Grid
  // Integrity is lost.
  clearUnits(): void {
    this.units = [];
  }

  // Remove every projectile in flight without applying its damage or crediting a tally.
  clearProjectiles(): void {
    this.projectiles = [];
  }

  // Release one unit at the map's entry through the real spawner, scaled to the current
  // wave. This engages the driver's hold on the spawner (specs/instrumentation.md): the run
  // enters a live wave whose spawn schedule is empty, so the units on the yard are exactly
  // the ones released here. That wave clears the ordinary way.
  debugSpawn(type: LoadType | "overload"): Unit | null {
    if (this.state !== "playing") return null;
    if (this.phase === "build") {
      this.phase = "wave";
      this.harvest = { mode: "none" };
      this.holding = false;
    }
    this.holdSpawner();
    this.occ = this.board.occupancy(this.structures);
    this.recomputeAuras();
    const u = this.makeUnit(type === "overload" ? "dynamo" : type);
    if (type === "overload") {
      u.invincible = true;
      u.maxHp = u.hp; // display only — the Overload Dynamo's health never falls
      u.radius = 28;
      u.speed = OVERLOAD_SPEED;
      this.finale = true;
    }
    this.units.push(u);
    return u;
  }

  // The hold itself: a live wave with an empty spawn schedule, so nothing arrives that the
  // surface did not release, and the wave still clears when the yard empties.
  private holdSpawner(): void {
    if (this.spawnerHeld && this.activeWave) return;
    this.spawnerHeld = true;
    this.activeWave = {
      wave: this.wave,
      events: [],
      durationMs: 0,
      types: [],
      hasBoss: false,
      hasAir: false,
    };
    this.spawnCursor = 0;
    this.waveClock = 0;
  }

  // Move a live unit to a logical position and leave it there. Its health, its statuses, and
  // the checkpoint it is heading for are untouched, so its route is re-solved from where it
  // now stands to the checkpoint it was already heading for.
  setUnitPosition(u: Unit, x: number, y: number): void {
    u.x = x;
    u.y = y;
    u.prevX = x;
    u.prevY = y;
    u.route = this.board.routeFor({ x, y }, u.wpIndex, this.occ, u.flies);
    u.routeStep = 0;
    u.progress = this.remainingTiles(u);
  }

  // Set the checkpoint a live unit is heading for. It moves the unit nowhere.
  setUnitWaypoint(u: Unit, index: number): void {
    u.wpIndex = index;
    u.route = this.board.routeFor(
      { x: u.x, y: u.y },
      u.wpIndex,
      this.occ,
      u.flies,
    );
    u.routeStep = 0;
    u.progress = this.remainingTiles(u);
  }

  // Set a live unit's current health. The maximum is never changed, so the unit stays the
  // same type at the same wave scaling and its bar reads the fraction it is on.
  setUnitHp(u: Unit, hp: number): void {
    u.hp = hp;
  }

  // Apply a slow through the rule specs/enemies.md fixes for an applied slow.
  setUnitSlow(u: Unit, amount: number, seconds: number): void {
    this.applySlow(u, amount, seconds);
  }

  // Apply a burn through the rule specs/enemies.md fixes for an applied burn. Its damage is
  // credited to no structure.
  setUnitBurn(u: Unit, dps: number, seconds: number): void {
    this.applyBurn(u, dps, seconds, 0);
  }

  // Hold one unit's travel, or release it. A held unit keeps every other faculty.
  setUnitFrozen(u: Unit, frozen: boolean): void {
    u.frozen = frozen;
  }

  // ---- Lookups the surface validates its arguments against ----------------------

  structureById(id: number): Structure | null {
    return this.structures.find((s) => s.id === id) ?? null;
  }

  liveUnitById(id: number): Unit | null {
    const u = this.unitById(id);
    return u && !u.dead ? u : null;
  }

  comboById(id: number): Component | null {
    const c = this.componentById(id);
    return c && c.combo ? c : null;
  }

  firingStructureById(id: number): Component | null {
    const c = this.componentById(id);
    return c && this.baseStatsOf(c).fires ? c : null;
  }

  baseStructureById(id: number): Candidate | Component | null {
    return this.baseStructById(id);
  }

  // A JSON-serializable read of the full observable state, shared by `window.__foundry`'s
  // `snapshot()` and the diagnostics overlay (specs/instrumentation.md). A pure read: every
  // field is taken straight off the game's own state or derived from it at the call, and
  // nothing here changes anything. The shape is fixed — every field is present on every
  // screen, and a field the current screen does not use reports its resting value.
  debugSnapshot() {
    const chain = this.board.chain;
    const entryNode = chain[0]!;
    const collectorNode = chain[chain.length - 1]!;
    const heldAnchor = this.holding
      ? this.board.pixelToAnchor(this.pointerX, this.pointerY)
      : null;
    return {
      version: FOUNDRY_DEBUG_VERSION,
      screen: this.state,
      // The yard is shown on `playing` and `paused`, so a run frozen behind the pause
      // menu is still in the phase it was in; only a screen with no yard reports none.
      phase:
        this.state === "playing" || this.state === "paused"
          ? this.finale
            ? ("finale" as const)
            : this.phase
          : null,
      menuIndex: this.menuIndex,
      paused: this.paused,
      map: this.map.id,
      difficulty: this.diff.key,
      wave: this.wave,
      totalWaves: this.diff.waves,
      waveActive: this.activeWave !== null || this.units.some((u) => !u.dead),
      waveHeld: this.waveHeld,
      charge: this.charge,
      integrity: this.integrity,
      refinement: this.refinement,
      qualityOdds: [...QUALITY_ODDS_BY_R[this.refinement]!],
      nextRoll: this.armedRoll
        ? { type: this.armedRoll.type, quality: this.armedRoll.tier }
        : null,
      stampsLeft: this.stampsLeft(),
      speed: this.speed,
      muted: this.muted,
      overlays: { combos: this.uiCombos, damage: this.uiBoard },
      mazeLength: this.mazeLengthTiles(),
      mazeRating: this.mazeRating,
      selected: this.selectedId,
      combineSet: this.combineSet(),
      pointer: { x: this.pointerX, y: this.pointerY },
      held: {
        active: heldAnchor !== null,
        col: heldAnchor?.col ?? 0,
        row: heldAnchor?.row ?? 0,
        legal: heldAnchor
          ? this.canPlaceAt(heldAnchor.col, heldAnchor.row)
          : false,
      },
      entry: { col: entryNode.col, row: entryNode.row },
      collector: { col: collectorNode.col, row: collectorNode.row },
      waypoints: this.map.waypoints.map((w, i) => ({
        index: i + 1,
        col: w.col,
        row: w.row,
      })),
      units: this.units
        .filter((u) => !u.dead)
        .map((u) => ({
          id: u.id,
          type: (u.invincible ? "overload" : u.type) as LoadType | "overload",
          x: u.x,
          y: u.y,
          hp: u.hp,
          maxHp: u.maxHp,
          speed: u.speed * u.slowFactor,
          baseSpeed: u.speed,
          flying: u.flies,
          frozen: u.frozen,
          waypointIndex: u.wpIndex,
          progress: u.progress,
          slowFactor: u.slowFactor,
          slowUntil: u.slowUntil,
          burnDps: u.burnDps,
          burnUntil: u.burnUntil,
          invincible: u.invincible,
        })),
      structures: this.structures.map((s) => this.structureSnap(s)),
      projectiles: this.projectiles
        .filter((p) => !p.dead)
        .map((p) => ({
          id: p.id,
          x: p.x,
          y: p.y,
          vx: Math.cos(p.angle) * p.speed,
          vy: Math.sin(p.angle) * p.speed,
          type: (p.combo ?? p.type) as string,
          heading: p.angle,
          damage: p.dmg,
          targetId: p.targetId,
        })),
      simTime: this.simTime,
    };
  }

  // One tower/candidate/blocker entry for the snapshot (specs/instrumentation.md). `damage` is
  // the piece's EFFECTIVE per-shot damage including any external aura buff on it; `auraRadius`
  // / `auraBonus` are the aura the piece itself PROJECTS (a Regulator / aura combo, else 0).
  private structureSnap(s: Structure): {
    id: number;
    kind: Structure["kind"] | "combo";
    type: ComponentType | ComboType | null;
    quality: Tier | null;
    level: number | null;
    col: number;
    row: number;
    cx: number;
    cy: number;
    range: number;
    damage: number;
    fireRate: number;
    targeting: TargetingMode | null;
    heading: number;
    firing: boolean;
    kills: number;
    damageDealt: number;
    auraRadius: number;
    auraBonus: number;
    abilities: string[];
  } {
    const ctr = footprintCenter(s.col, s.row);
    const inert = {
      id: s.id,
      col: s.col,
      row: s.row,
      cx: ctr.x,
      cy: ctr.y,
      heading: 0,
      firing: false,
      kills: 0,
      damageDealt: 0,
    };
    if (s.kind === "blocker") {
      return {
        ...inert,
        kind: "blocker",
        type: null,
        quality: null,
        level: null,
        range: 0,
        damage: 0,
        fireRate: 0,
        targeting: null,
        auraRadius: 0,
        auraBonus: 0,
        abilities: [],
      };
    }
    if (s.kind === "candidate") {
      const st = deriveStats(s.type, s.tier);
      return {
        ...inert,
        kind: "candidate",
        type: s.type,
        quality: s.tier,
        level: null,
        range: st.range,
        damage: st.dmg,
        fireRate: st.fireRate,
        targeting: null,
        auraRadius: st.auraRadius,
        auraBonus: st.auraBonus,
        abilities: abilitiesOf(st),
      };
    }
    const isCombo = !!s.combo;
    const base = this.baseStatsOf(s);
    const eff = this.statsOf(s);
    return {
      id: s.id,
      col: s.col,
      row: s.row,
      cx: ctr.x,
      cy: ctr.y,
      kind: isCombo ? "combo" : "component",
      type: isCombo ? s.combo! : s.type,
      quality: isCombo ? null : s.tier,
      level: isCombo ? s.comboLevel : null,
      range: eff.range,
      damage: eff.dmg,
      fireRate: eff.fireRate,
      targeting: eff.fires ? s.targeting : null,
      heading: s.aimAngle,
      firing: s.fireAnim < 0.1,
      kills: s.kills,
      damageDealt: s.damageDealt,
      auraRadius: base.auraRadius,
      auraBonus: base.auraBonus,
      abilities: abilitiesOf(eff),
    };
  }
}

// The firing family a structure's shot belongs to (specs/ui.md). A combination tower plays
// the cue of the family its dominant output belongs to; a base component plays its type's.
function fireFamily(c: Component): Cue {
  return c.combo ? COMBO_FIRE_CUE[c.combo] : FIRE_CUE[c.type];
}

// The ability tags a firing tower's live stats carry (specs/components.md), for
// the snapshot of specs/instrumentation.md.
function abilitiesOf(st: CompStats): string[] {
  const a: string[] = [];
  if (st.splash > 0) a.push("splash");
  if (st.chainLeaps > 0) a.push("chain");
  if (st.slowAmt > 0) a.push("slow");
  if (st.burnFrac > 0) a.push("burn");
  if (st.critChance > 0) a.push("crit");
  if (st.multishot > 1) a.push("multishot");
  if (st.auraRadius > 0) a.push("aura");
  return a;
}

// The JSON-serializable shape window.__foundry.snapshot() returns (specs/instrumentation.md).
export type FoundrySnapshot = ReturnType<Game["debugSnapshot"]>;
