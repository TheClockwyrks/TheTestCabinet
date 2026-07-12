// Holdfast — the simulation orchestrator (DESIGN §4, §6, specs/flow.md).
//
// The Game class owns the whole colony: the tile world, the settlers and raiders, the drops,
// tracers, structures, and open job queue, the stock, the day/night clock, the threat
// director, the camera and tool/build state, and the run score. fixedStep(dt) runs one
// deterministic tick in the DESIGN §6 order — clock, needs & mood, job regen, per-settler
// behaviour (a critical need or a live raid overrides the queue), structure growth, the
// threat director, shooting, downed/bleed, decay, cull, milestones, and the loss check.
// It is DOM-free: rendering, audio, and particles read this state and drain fxQueue/sndQueue.
// The same fixedStep drives the browser and the headless balance harness; the command
// surface at the bottom (also the window.__holdfast proof hooks) is the only way in.

import {
  DAY_SECONDS,
  EAT_THRESHOLD,
  EAT_TIME,
  EVENT_MOOD_DECAY,
  FLOOR_MOVE_MUL,
  FARM_GROW_GRASS,
  FARM_GROW_SOIL,
  HUNGER_RISE,
  MOOD_BASE,
  MOOD_BREAK,
  MOOD_COM_FED_RESTED,
  MOOD_COM_FLOOR_ROOM,
  MOOD_COM_OWN_BED,
  MOOD_PEN_ALLY_DIED,
  MOOD_PEN_ALLY_DOWNED,
  MOOD_PEN_COMBAT,
  MOOD_PEN_EXHAUSTED,
  MOOD_PEN_GROUND,
  MOOD_PEN_HUNGRY,
  REST_DRAIN_DAY,
  REST_NIGHT_MUL,
  SETTLER_HEALTH,
  SETTLER_SPEED,
  SKILL_GROWTH,
  SKILL_MAX,
  SLEEP_REST_BED,
  SLEEP_REST_GROUND,
  SLEEP_TRIGGER_DAY,
  SLEEP_TRIGGER_NIGHT,
  SLEEP_WAKE,
  SPEEDS,
  STARVE_HP,
  START_DAY,
  START_TIME,
  STRUCTURES,
  SETTLER_ARCHETYPES,
  WORK_ORDER,
  ZOOM_DEFAULT_INDEX,
  ZOOM_LEVELS,
  isDaylight,
  phaseOf,
  type Activity,
  type JobKind,
  type ResourceKind,
  type Skill,
  type StructureKind,
  type Tool,
  type WorkType,
} from "./constants";
import { MODE } from "./mode";
import { RNG } from "./rng";
import { Threat, resolveShooting, updateDowned } from "./combat";
import { advanceJob, assignJob, regenJobs } from "./jobs";
import { endOf, findPath, isReachable, moveAlong, reachableAdjacent } from "./pathfind";
import {
  World,
  centerOn,
  clampCamera,
  generateWorld,
  idx,
  setStructure,
  tileCenterX,
  tileCenterY,
  tileOfPixelX,
  tileOfPixelY,
} from "./world";
import { COLS } from "./constants";
import type {
  Cue,
  Drop,
  FxEvent,
  FxKind,
  GameState,
  Job,
  Phase,
  PathNode,
  Raider,
  Settler,
  Structure,
  Toast,
  Tracer,
} from "./types";

const FIXED_STEP = 0.1; // local mirror of constants (also the harness's tick size)

export interface Score {
  days: number; // days survived (primary): (day-1) + fractional time at loss
  raidsRepelled: number;
  raidersKilled: number;
  structuresBuilt: number;
  peakPop: number;
}

export class Game {
  world: World;
  state: GameState = "title";
  phase: Phase = "dawn";

  // Day/night clock.
  time = START_TIME; // 0..1 within the current day
  day = START_DAY;
  speed = 1; // 1 / 2 / 3
  paused = false; // in-place Space pause (freezes ticks; board stays interactive)

  // Entities and world state.
  settlers: Settler[] = [];
  raiders: Raider[] = [];
  drops: Drop[] = [];
  structures: Structure[] = [];
  jobs: Job[] = []; // the open job queue (unclaimed rebuilt each tick + claimed carried over)
  tracers: Tracer[] = [];
  toasts: Toast[] = [];

  stock = { wood: 0, ore: 0, crops: 0, meals: 0 };

  // Camera / tool / selection (owned here; read by render.ts and input.ts).
  camX = 0;
  camY = 0;
  zoomIndex = ZOOM_DEFAULT_INDEX;
  tool: Tool = "none";
  buildKind: StructureKind | null = null;
  designateKind: "chop" | "mine" | null = null;
  selectedSettlerId: number | null = null;

  // Threat director + raid banner state (drained by the HUD).
  threat: Threat;
  raidActive = false;
  raidIncoming = false;
  raidCountdown = 0;

  // Work-priority grid: settlerId → per-work-type priority (0 off .. 4 top).
  priority: Record<number, Record<WorkType, number>> = {};

  score: Score = { days: 0, raidsRepelled: 0, raidersKilled: 0, structuresBuilt: 0, peakPop: 0 };

  // Presentation queues, drained by main.ts each frame.
  fxQueue: FxEvent[] = [];
  sndQueue: Cue[] = [];

  rng: RNG;
  private idSeq = 1;
  private milestones = new Set<string>();

  constructor() {
    this.world = generateWorld(MODE.mapSeed);
    this.rng = new RNG(MODE.mapSeed ^ 0x9e3779b9);
    this.threat = new Threat(this);
    this.centerCameraOnLanding();
  }

  get zoom(): number {
    return ZOOM_LEVELS[this.zoomIndex]!;
  }
  // Days since the run began, the scale the threat director schedules on and the score.
  get nowDays(): number {
    return this.day - 1 + this.time;
  }

  nextEntityId(): number {
    return this.idSeq++;
  }

  // ---- Lifecycle --------------------------------------------------------------
  startBase(): void {
    this.world = generateWorld(MODE.mapSeed);
    this.rng = new RNG(MODE.mapSeed ^ 0x9e3779b9);
    this.threat = new Threat(this);
    this.state = "playing";
    this.paused = false;
    this.time = START_TIME;
    this.day = START_DAY;
    this.speed = 1;
    this.phase = phaseOf(this.time);
    this.settlers = [];
    this.raiders = [];
    this.drops = [];
    this.structures = [];
    this.jobs = [];
    this.tracers = [];
    this.toasts = [];
    this.priority = {};
    this.milestones.clear();
    this.stock = { ...MODE.stock };
    this.tool = "none";
    this.buildKind = null;
    this.designateKind = null;
    this.selectedSettlerId = null;
    this.raidActive = false;
    this.raidIncoming = false;
    this.raidCountdown = 0;
    this.score = { days: 0, raidsRepelled: 0, raidersKilled: 0, structuresBuilt: 0, peakPop: 0 };
    this.spawnCrew();
    this.centerCameraOnLanding();
  }

  restart(): void {
    this.startBase();
  }

  private spawnCrew(): void {
    const l = this.world.landing;
    // lay the crew out on open ground around the landing site
    const spots: PathNode[] = [
      { tx: l.tx - 2, ty: l.ty },
      { tx: l.tx + 2, ty: l.ty },
      { tx: l.tx, ty: l.ty + 2 },
      { tx: l.tx - 2, ty: l.ty + 1 },
    ];
    for (let i = 0; i < MODE.crew; i++) {
      const arch = SETTLER_ARCHETYPES[i % SETTLER_ARCHETYPES.length]!;
      const spot = spots[i % spots.length]!;
      const id = this.nextEntityId();
      this.settlers.push({
        id,
        name: arch.name,
        x: tileCenterX(spot.tx),
        y: tileCenterY(spot.ty),
        facing: 0,
        health: SETTLER_HEALTH,
        maxHealth: SETTLER_HEALTH,
        needs: { hunger: this.rng.range(0, 0.15), rest: this.rng.range(0.85, 1), mood: MOOD_BASE },
        skills: { ...arch.skills },
        job: null,
        path: [],
        pathIdx: 0,
        activity: "idle",
        animT: 0,
        carrying: null,
        downed: false,
        bleed: 0,
        fireCooldown: 0,
        eventMood: 0,
        moodBreak: false,
        bedId: null,
        dead: false,
      });
      // default work grid: everything on at the middle priority
      const grid = {} as Record<WorkType, number>;
      for (const w of WORK_ORDER) grid[w] = 3;
      this.priority[id] = grid;
    }
  }

  private centerCameraOnLanding(): void {
    const c = centerOn(this.world.landing.tx, this.world.landing.ty, this.zoom);
    this.camX = c.x;
    this.camY = c.y;
  }

  // ---- The fixed simulation step ----------------------------------------------
  fixedStep(dt: number): void {
    if (this.state !== "playing" || this.paused) return;
    this.tick(dt);
  }

  private tick(dt: number): void {
    // 1. Clock.
    this.advanceClock(dt);
    // 2. Needs & mood.
    for (const s of this.settlers) this.updateNeeds(s, dt);
    // 3. Job regen.
    regenJobs(this);
    // 4. Per-settler behaviour.
    for (const s of this.settlers) this.stepSettler(s, dt);
    // 5. Structures (farm growth; stove/turret working state set by cook/shooting).
    this.stepStructures(dt);
    // 6. Threat director (schedule/announce/spawn/escalate + raider movement).
    this.threat.update(this, dt);
    // 7. Shooting.
    resolveShooting(this, dt);
    // 8. Downed / bleed / tend.
    updateDowned(this, dt);
    // 9. Drops / tracers / toasts decay.
    this.stepDecay(dt);
    // 10. Cull dead; milestones.
    this.cullDead();
    this.peakPopUpdate();
    // 11. Loss check.
    this.checkLoss();
  }

  private advanceClock(dt: number): void {
    this.time += dt / DAY_SECONDS;
    while (this.time >= 1) {
      this.time -= 1;
      this.day += 1;
      if (this.day % 5 === 0) this.toast(`Day ${this.day} survived`);
    }
    this.phase = phaseOf(this.time);
  }

  // ---- Needs & mood -----------------------------------------------------------
  private updateNeeds(s: Settler, dt: number): void {
    if (s.dead) return;
    // transient event mood decays toward 0
    if (s.eventMood < 0) s.eventMood = Math.min(0, s.eventMood + EVENT_MOOD_DECAY * dt);
    if (s.downed) {
      this.recomputeMood(s);
      return;
    }
    const sleeping = s.activity === "sleep";
    if (!sleeping) {
      s.needs.hunger = Math.min(1, s.needs.hunger + HUNGER_RISE * dt);
      const nightMul = this.phase === "night" ? REST_NIGHT_MUL : 1;
      s.needs.rest = Math.max(0, s.needs.rest - REST_DRAIN_DAY * nightMul * dt);
    }
    if (s.needs.hunger >= 1) {
      s.health -= STARVE_HP * dt;
      if (s.health <= 0) {
        this.killSettler(s);
        return;
      }
    }
    this.recomputeMood(s);
    s.moodBreak = s.needs.mood < MOOD_BREAK;
  }

  private recomputeMood(s: Settler): void {
    let m = MOOD_BASE;
    if (s.needs.hunger >= EAT_THRESHOLD) m -= MOOD_PEN_HUNGRY;
    if (s.needs.rest <= SLEEP_TRIGGER_DAY) m -= MOOD_PEN_EXHAUSTED;
    if (s.activity === "sleep" && !this.onBed(s)) m -= MOOD_PEN_GROUND;
    if (this.raidActive && s.activity === "fight") m -= MOOD_PEN_COMBAT;
    m += s.eventMood; // negative
    if (s.bedId !== null) m += MOOD_COM_OWN_BED;
    if (s.needs.hunger < 0.3 && s.needs.rest > 0.7) m += MOOD_COM_FED_RESTED;
    if (this.onFloor(s)) m += MOOD_COM_FLOOR_ROOM;
    s.needs.mood = Math.max(0, Math.min(1, m));
  }

  // ---- Per-settler behaviour --------------------------------------------------
  private stepSettler(s: Settler, dt: number): void {
    if (s.dead || s.downed) return;
    s.animT += dt;

    // Continue an in-progress meal (eaten in place from the colony stock).
    if (s.job && s.job.kind === "eat") {
      s.activity = "eat";
      if (advanceJob(this, s, dt)) this.completeJob(s);
      return;
    }

    // A live raid overrides the queue: fighters fight, the rest flee (specs/combat.md).
    if (this.raidActive) {
      if (this.priorityOf(s.id, "fight") > 0) this.fightBehaviour(s, dt);
      else this.fleeBehaviour(s, dt);
      return;
    }

    // Sleep when tired (walks to a bed if it can reach one, else sleeps on the ground).
    if (this.handleSleep(s, dt)) return;

    // Eat when hungry and there are meals.
    if (s.needs.hunger >= EAT_THRESHOLD && this.stock.meals > 0) {
      this.startEat(s);
      return;
    }

    // Extreme low mood: wander, upset — refuses ordinary work until it recovers.
    if (s.moodBreak) {
      this.releaseJob(s);
      s.activity = "idle";
      return;
    }

    this.handleWork(s, dt);
  }

  private handleWork(s: Settler, dt: number): void {
    if (!s.job) assignJob(this, s);
    if (!s.job) {
      s.activity = "idle";
      return;
    }
    // Haul while carrying walks home; otherwise walk to the work tile.
    const arrived = moveAlong(s, this.walkSpeed(s), dt);
    if (!arrived) {
      s.activity = s.carrying ? "haul" : "walk";
      return;
    }
    s.activity = ACTIVITY_OF[s.job.kind];
    if (advanceJob(this, s, dt)) this.completeJob(s);
  }

  private startEat(s: Settler): void {
    this.releaseJob(s);
    const t = this.tileOf(s);
    s.job = { kind: "eat", tx: t.tx, ty: t.ty, claimedBy: s.id, work: 0, workNeeded: EAT_TIME };
    s.path = [];
    s.pathIdx = 0;
    s.activity = "eat";
  }

  // Returns true when sleep is handling the settler this tick (walking to a bed or asleep).
  private handleSleep(s: Settler, dt: number): boolean {
    const trigger = this.phase === "night" ? SLEEP_TRIGGER_NIGHT : SLEEP_TRIGGER_DAY;
    const midSleep = s.activity === "sleep" && s.needs.rest < SLEEP_WAKE;
    if (!midSleep && s.needs.rest > trigger) return false;

    const at = this.tileOf(s);
    const bed = this.findBed(s);
    if (bed && !(at.tx === bed.tx && at.ty === bed.ty)) {
      const tgt = this.pathTargetTile(s);
      if (!tgt || tgt.tx !== bed.tx || tgt.ty !== bed.ty) this.pathTo(s, bed);
      if (s.pathIdx < s.path.length) {
        s.activity = "walk";
        moveAlong(s, this.walkSpeed(s), dt);
        return true;
      }
    }
    this.releaseJob(s);
    s.activity = "sleep";
    const rate = this.onBed(s) ? SLEEP_REST_BED : SLEEP_REST_GROUND;
    s.needs.rest = Math.min(1, s.needs.rest + rate * dt);
    return true;
  }

  private findBed(s: Settler): PathNode | null {
    if (s.bedId !== null) {
      const t = this.tileFromIdx(s.bedId);
      if (t && t.structure && t.structure.built && t.structure.kind === "bed") return { tx: t.x, ty: t.y };
      s.bedId = null;
    }
    const owned = new Set(this.settlers.filter((o) => o.bedId !== null).map((o) => o.bedId));
    const from = this.tileOf(s);
    for (const b of this.structures) {
      if (!b.built || b.kind !== "bed") continue;
      const id = idx(b.tx, b.ty);
      if (owned.has(id)) continue;
      if (isReachable(this.world, from, { tx: b.tx, ty: b.ty })) {
        s.bedId = id;
        return { tx: b.tx, ty: b.ty };
      }
    }
    return null;
  }

  // ---- Combat behaviours (raid override) --------------------------------------
  private fightBehaviour(s: Settler, dt: number): void {
    this.releaseJob(s);
    const tgt = this.nearestRaiderPixel(s.x, s.y);
    if (!tgt) {
      s.activity = "fight"; // no raider in sight — stand ready
      return;
    }
    const at = this.tileOf(s);
    const tt = { tx: tileOfPixelX(tgt.x), ty: tileOfPixelY(tgt.y) };
    const dist = Math.hypot(tgt.x - s.x, tgt.y - s.y);
    const los = this.world.lineOfSight(at.tx, at.ty, tt.tx, tt.ty);
    if (los && dist <= 120 * 0.9) {
      s.path = [];
      s.pathIdx = 0;
      s.activity = "fight";
      s.facing = Math.atan2(tgt.y - s.y, tgt.x - s.x);
      return;
    }
    // Relocate to a firing slot behind cover, or approach the raider.
    if (s.pathIdx >= s.path.length) {
      const slot = this.findFiringSlot(s, tgt) ?? tt;
      const path = reachableAdjacent(this.world, at, slot);
      s.path = path ?? [];
      s.pathIdx = 0;
    }
    const arrived = moveAlong(s, this.walkSpeed(s), dt);
    s.activity = arrived ? "fight" : "walk";
    if (arrived) s.facing = Math.atan2(tgt.y - s.y, tgt.x - s.x);
  }

  private fleeBehaviour(s: Settler, dt: number): void {
    this.releaseJob(s);
    if (s.pathIdx >= s.path.length) {
      const path = findPath(this.world, this.tileOf(s), this.world.landing);
      s.path = path ?? [];
      s.pathIdx = 0;
    }
    const arrived = moveAlong(s, this.walkSpeed(s), dt);
    s.activity = arrived ? "idle" : "flee";
  }

  // The nearest cover tile (adjacent to a wall/door) that can see the target, is in range,
  // and is reachable — a firing slot to fight from behind the wall line (specs/combat.md).
  private findFiringSlot(s: Settler, tgt: { x: number; y: number }): PathNode | null {
    const at = this.tileOf(s);
    const tt = { tx: tileOfPixelX(tgt.x), ty: tileOfPixelY(tgt.y) };
    const candidates: { tile: PathNode; d: number }[] = [];
    for (const c of this.coverSlots()) {
      const wd = Math.hypot(tileCenterX(c.tx) - tgt.x, tileCenterY(c.ty) - tgt.y);
      if (wd > 120) continue;
      if (!this.world.lineOfSight(c.tx, c.ty, tt.tx, tt.ty)) continue;
      candidates.push({ tile: c, d: Math.hypot(c.tx - at.tx, c.ty - at.ty) });
    }
    candidates.sort((a, b) => a.d - b.d);
    for (const c of candidates) {
      if (isReachable(this.world, at, c.tile)) return c.tile;
    }
    return null;
  }

  // Walkable tiles beside a built cover-giving structure (wall/door/turret).
  private coverSlots(): PathNode[] {
    const out: PathNode[] = [];
    const seen = new Set<number>();
    for (const st of this.structures) {
      if (!st.built || !STRUCTURES[st.kind].cover) continue;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = st.tx + dx;
          const ny = st.ty + dy;
          if (!this.world.passable(nx, ny)) continue;
          const id = idx(nx, ny);
          if (seen.has(id)) continue;
          seen.add(id);
          out.push({ tx: nx, ty: ny });
        }
      }
    }
    return out;
  }

  private nearestRaiderPixel(x: number, y: number): { x: number; y: number } | null {
    let best: { x: number; y: number } | null = null;
    let bestD = Infinity;
    for (const r of this.raiders) {
      if (r.dead) continue;
      const d = Math.hypot(r.x - x, r.y - y);
      if (d < bestD) {
        bestD = d;
        best = { x: r.x, y: r.y };
      }
    }
    return best;
  }

  // ---- Structures -------------------------------------------------------------
  private stepStructures(dt: number): void {
    if (!isDaylight(this.phase)) return; // farms only grow in daylight (specs/time.md)
    for (const s of this.structures) {
      if (!s.built || s.kind !== "farm" || s.cropStage !== 1) continue;
      const t = this.world.tileAt(s.tx, s.ty);
      const rate = t && t.terrain === "grass" ? FARM_GROW_GRASS : FARM_GROW_SOIL;
      s.growth = Math.min(1, s.growth + rate * dt);
      if (s.growth >= 1) s.cropStage = 2; // ripe → a harvest job appears next regen
    }
  }

  // ---- Decay / cull -----------------------------------------------------------
  private stepDecay(dt: number): void {
    for (const tr of this.tracers) tr.life -= dt;
    if (this.tracers.some((t) => t.life <= 0)) this.tracers = this.tracers.filter((t) => t.life > 0);
    for (const t of this.toasts) t.life -= dt;
    if (this.toasts.some((t) => t.life <= 0)) this.toasts = this.toasts.filter((t) => t.life > 0);
  }

  private cullDead(): void {
    if (this.raiders.some((r) => r.dead)) this.raiders = this.raiders.filter((r) => !r.dead);
    // dead settlers stay in the array (the roster greys them / the loss check counts living)
  }

  private peakPopUpdate(): void {
    const pop = this.livingSettlers().length;
    if (pop > this.score.peakPop) this.score.peakPop = pop;
  }

  private checkLoss(): void {
    if (this.state !== "playing") return;
    if (this.livingSettlers().length === 0) {
      this.state = "gameover";
      this.score.days = this.nowDays;
    }
  }

  // ---- Death / structure destruction ------------------------------------------
  downSettler(s: Settler): void {
    if (s.dead || s.downed) return;
    s.downed = true;
    s.health = 0;
    s.bleed = 45; // BLEED
    s.activity = "downed";
    this.releaseJob(s);
    for (const o of this.settlers) if (o.id !== s.id && !o.dead) o.eventMood -= MOOD_PEN_ALLY_DOWNED;
    this.pushFx("blood", s.x, s.y);
  }

  killSettler(s: Settler): void {
    if (s.dead) return;
    s.dead = true;
    s.downed = false;
    s.activity = "downed";
    s.health = 0;
    s.bedId = null;
    this.releaseJob(s);
    for (const o of this.settlers) if (o.id !== s.id && !o.dead) o.eventMood -= MOOD_PEN_ALLY_DIED;
    this.pushFx("blood", s.x, s.y);
  }

  destroyTurret(t: Structure): void {
    t.hp = 0;
    setStructure(this.world, null, t.tx, t.ty);
    this.structures = this.structures.filter((o) => o !== t);
    this.pushFx("explosion", tileCenterX(t.tx), tileCenterY(t.ty));
    this.pushFx("fire", tileCenterX(t.tx), tileCenterY(t.ty));
  }

  // ---- Job / world helpers used by jobs.ts & combat.ts ------------------------
  tileOf(e: { x: number; y: number }): PathNode {
    return { tx: tileOfPixelX(e.x), ty: tileOfPixelY(e.y) };
  }
  private tileFromIdx(id: number): { x: number; y: number; structure: Structure | null; terrain: string } | null {
    const x = id % COLS;
    const y = (id - x) / COLS;
    return this.world.tileAt(x, y);
  }
  private pathTargetTile(s: Settler): PathNode | null {
    return s.path.length > 0 ? s.path[s.path.length - 1]! : null;
  }
  pathTo(s: Settler, tile: PathNode): void {
    const path = findPath(this.world, this.tileOf(s), tile);
    s.path = path ?? [];
    s.pathIdx = 0;
  }
  private walkSpeed(s: Settler): number {
    const t = this.tileOf(s);
    return SETTLER_SPEED * (this.world.isFloor(t.tx, t.ty) ? FLOOR_MOVE_MUL : 1);
  }
  private onBed(s: Settler): boolean {
    const t = this.world.tileAt(tileOfPixelX(s.x), tileOfPixelY(s.y));
    return !!(t && t.structure && t.structure.built && t.structure.kind === "bed");
  }
  private onFloor(s: Settler): boolean {
    return this.world.isFloor(tileOfPixelX(s.x), tileOfPixelY(s.y));
  }

  priorityOf(id: number, work: WorkType): number {
    return this.priority[id]?.[work] ?? 0;
  }
  settlerById(id: number): Settler | undefined {
    return this.settlers.find((s) => s.id === id);
  }
  dropById(id: number): Drop | undefined {
    return this.drops.find((d) => d.id === id);
  }
  livingSettlers(): Settler[] {
    return this.settlers.filter((s) => !s.dead);
  }

  addDrop(tx: number, ty: number, res: ResourceKind, amount: number): void {
    this.drops.push({ id: this.nextEntityId(), tx, ty, res, amount });
  }
  removeDrop(id: number): void {
    this.drops = this.drops.filter((d) => d.id !== id);
  }

  growSkill(s: Settler, skill: Skill): void {
    s.skills[skill] = Math.min(SKILL_MAX, s.skills[skill] + SKILL_GROWTH);
  }

  finishStructure(s: Structure): void {
    s.built = true;
    s.progress = 1;
    const def = STRUCTURES[s.kind];
    if (def.hp > 0) {
      s.hp = def.hp;
      s.maxHp = def.hp;
    }
    setStructure(this.world, s, s.tx, s.ty);
    this.score.structuresBuilt += 1;
    this.pushFx("dust", tileCenterX(s.tx), tileCenterY(s.ty));
    this.pushCue("build");
    if (s.kind === "turret") this.milestone("firstTurret", "First turret online");
  }

  private completeJob(s: Settler): void {
    const job = s.job;
    if (job) this.jobs = this.jobs.filter((j) => j !== job);
    s.job = null;
    s.activity = "idle";
  }
  private releaseJob(s: Settler): void {
    if (s.job) {
      s.job.claimedBy = null;
      s.job = null;
    }
  }

  onRaidRepelled(): void {
    this.milestone("firstRepel", "First raid repelled");
  }
  private milestone(key: string, text: string): void {
    if (this.milestones.has(key)) return;
    this.milestones.add(key);
    this.toast(text);
  }
  toast(text: string): void {
    this.toasts.push({ text, life: 4 });
  }

  pushFx(kind: FxKind, x: number, y: number): void {
    this.fxQueue.push({ kind, x, y });
  }
  pushCue(cue: Cue): void {
    this.sndQueue.push(cue);
  }

  // ---- Player / command surface (input.ts + the window.__holdfast proof hooks) -
  setState(s: GameState): void {
    this.state = s;
  }

  togglePause(): void {
    if (this.state === "playing") this.paused = !this.paused;
  }
  cycleSpeed(): void {
    const i = SPEEDS.indexOf(this.speed);
    this.speed = SPEEDS[(i + 1) % SPEEDS.length]!;
  }
  setSpeed(n: number): void {
    if (SPEEDS.includes(n)) this.speed = n;
  }

  selectSettler(id: number | null): void {
    this.selectedSettlerId = id;
  }
  setPriority(id: number, work: WorkType, p: number): void {
    const grid = this.priority[id] ?? ({} as Record<WorkType, number>);
    grid[work] = Math.max(0, Math.min(4, Math.floor(p)));
    this.priority[id] = grid;
  }
  cyclePriority(id: number, work: WorkType): void {
    this.setPriority(id, work, (this.priorityOf(id, work) + 1) % 5);
  }

  // Rectangle designate: auto-reads the node under each tile (single designate tool), or
  // restricts to `kind` when one is given (the proof hook passes it explicitly).
  designateRect(tx0: number, ty0: number, tx1: number, ty1: number, kind?: "chop" | "mine"): void {
    const x0 = Math.min(tx0, tx1);
    const x1 = Math.max(tx0, tx1);
    const y0 = Math.min(ty0, ty1);
    const y1 = Math.max(ty0, ty1);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const t = this.world.tileAt(x, y);
        if (!t || !t.node) continue;
        const want: "chop" | "mine" = t.node.kind === "tree" ? "chop" : "mine";
        if (kind && kind !== want) continue;
        t.designated = want;
      }
    }
  }

  canPlace(kind: StructureKind, tx: number, ty: number): boolean {
    const t = this.world.tileAt(tx, ty);
    if (!t || t.terrain === "rock" || t.node || t.structure) return false;
    if (kind === "door") return this.doorInWallLine(tx, ty);
    if (kind === "turret") {
      // a field of fire: at least one non-occluding neighbour to shoot over
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const n = this.world.tileAt(tx + dx, ty + dy);
        if (n && !n.blocksSight) return true;
      }
      return false;
    }
    return true;
  }
  private isWallLike(tx: number, ty: number): boolean {
    const t = this.world.tileAt(tx, ty);
    return !!(t && t.structure && t.structure.kind === "wall");
  }
  private doorInWallLine(tx: number, ty: number): boolean {
    return (this.isWallLike(tx - 1, ty) && this.isWallLike(tx + 1, ty)) || (this.isWallLike(tx, ty - 1) && this.isWallLike(tx, ty + 1));
  }

  canAfford(kind: StructureKind): boolean {
    const c = STRUCTURES[kind].cost;
    return this.stock.wood >= c.wood && this.stock.ore >= c.ore;
  }

  // Place a build ghost: material is deducted at placement (specs/economy.md). Refused if the
  // spot is illegal or unaffordable.
  placeGhost(kind: StructureKind, tx: number, ty: number): boolean {
    if (!this.canPlace(kind, tx, ty) || !this.canAfford(kind)) return false;
    const c = STRUCTURES[kind].cost;
    this.stock.wood -= c.wood;
    this.stock.ore -= c.ore;
    this.addStructure(kind, tx, ty, false);
    return true;
  }

  private addStructure(kind: StructureKind, tx: number, ty: number, built: boolean): Structure {
    const def = STRUCTURES[kind];
    const s: Structure = {
      kind,
      tx,
      ty,
      hp: def.hp,
      maxHp: def.hp,
      built,
      progress: built ? 1 : 0,
      costPaid: true,
      active: false,
      cropStage: 0,
      growth: 0,
      cooldown: 0,
      aim: 0,
    };
    this.structures.push(s);
    setStructure(this.world, s, tx, ty);
    return s;
  }

  // Cancel: refund a ghost's full cost and remove it; else clear a designation; else
  // deconstruct a built structure (no refund).
  cancelAt(tx: number, ty: number): void {
    const t = this.world.tileAt(tx, ty);
    if (!t) return;
    if (t.structure && !t.structure.built) {
      const c = STRUCTURES[t.structure.kind].cost;
      this.stock.wood += c.wood;
      this.stock.ore += c.ore;
      this.removeStructure(t.structure);
    } else if (t.designated) {
      t.designated = null;
    } else if (t.structure && t.structure.built) {
      this.removeStructure(t.structure);
    }
  }
  private removeStructure(s: Structure): void {
    this.structures = this.structures.filter((o) => o !== s);
    setStructure(this.world, null, s.tx, s.ty);
  }

  camTo(tx: number, ty: number): void {
    const c = centerOn(tx, ty, this.zoom);
    this.camX = c.x;
    this.camY = c.y;
  }
  // Pan the camera by a world-pixel delta and clamp it flush to the world bounds.
  panBy(dx: number, dy: number): void {
    const c = clampCamera(this.camX + dx, this.camY + dy, this.zoom);
    this.camX = c.x;
    this.camY = c.y;
  }
  // Re-clamp after a zoom change (the viewport's world size changed).
  reclampCamera(): void {
    const c = clampCamera(this.camX, this.camY, this.zoom);
    this.camX = c.x;
    this.camY = c.y;
  }

  // ---- Proof / balance-harness hooks (window.__holdfast, inert in normal play) --
  grant(res: ResourceKind, n: number): void {
    this.stock[res] = Math.max(0, this.stock[res] + n);
  }
  // Run N sim-seconds forward at the fixed step (setup fast-forward). Runs even while paused.
  advance(seconds: number): void {
    const n = Math.max(0, Math.round(seconds / FIXED_STEP));
    for (let i = 0; i < n && this.state === "playing"; i++) this.tick(FIXED_STEP);
  }
  // Place a finished structure directly (proof setup): built, no build wait, cost if afforded.
  build(kind: StructureKind, tx: number, ty: number): boolean {
    if (!this.canPlace(kind, tx, ty)) return false;
    if (this.canAfford(kind)) {
      const c = STRUCTURES[kind].cost;
      this.stock.wood -= c.wood;
      this.stock.ore -= c.ore;
    }
    const s = this.addStructure(kind, tx, ty, true);
    this.score.structuresBuilt += 1;
    if (s.kind === "turret") this.milestone("firstTurret", "First turret online");
    return true;
  }
  triggerRaid(n?: number): void {
    this.pushCue("alarm");
    this.threat.spawnRaid(this, n);
  }
  forcePhase(phase: Phase): void {
    this.time = phase === "dawn" ? 0.03 : phase === "day" ? 0.25 : phase === "dusk" ? 0.53 : 0.72;
    this.phase = phaseOf(this.time);
  }
  hurtSettler(id: number, dmg: number): void {
    const s = this.settlerById(id);
    if (!s || s.dead) return;
    s.health -= dmg;
    this.pushFx("blood", s.x, s.y);
    if (s.health <= 0) this.downSettler(s);
  }
  killAll(): void {
    for (const s of this.settlers) this.killSettler(s);
    this.checkLoss();
  }

  // ---- Derived reads for the HUD ----------------------------------------------
  get selectedSettler(): Settler | null {
    return this.selectedSettlerId != null ? (this.settlers.find((s) => s.id === this.selectedSettlerId) ?? null) : null;
  }
  // The tile an entity ends up on after walking its path (for render interpolation targets).
  destinationOf(s: Settler): PathNode {
    return endOf(s.path, this.tileOf(s));
  }
}

// Activity a settler shows while performing each queue job kind.
const ACTIVITY_OF: Record<JobKind, Activity> = {
  chop: "chop",
  mine: "mine",
  haul: "haul",
  build: "build",
  cook: "cook",
  sow: "farm",
  harvest: "farm",
  fight: "fight",
  tend: "tend",
  eat: "eat",
  sleep: "sleep",
};
