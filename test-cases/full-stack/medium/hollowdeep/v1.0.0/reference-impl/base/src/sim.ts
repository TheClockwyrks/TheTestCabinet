// Hollowdeep — the simulation spine: the Game class (specs/flow.md and all it references).
//
// A fixed-step, DOM-free model of the sealed colony: the tile world under gas + power, the
// delvers who pull jobs and tend their needs, the refine/build/food economy, the cycle
// clock, and the win/lose (there is no win — survival is open-ended; the colony is LOST when
// the last delver dies, specs/flow.md). fixedStep(dt) advances everything in one order and
// is driven identically by the browser (src/main.ts) and the headless balance harness
// (sim/). Rendering, audio, and particles read this state and drain its event queues
// (fxQueue / sndQueue / milestones); the sim never touches them. Mirrors valence's sim.ts.

import {
  CYCLE_SECONDS,
  DIG_TIME,
  HEALTH_MAX,
  HUNGER_MAX,
  HUNGER_RATE,
  O2_RECOVER,
  REST_BELOW,
  REST_RECOVER,
  REST_UNTIL,
  STAMINA_MAX,
  STARVE_DMG,
  SUFFOCATE_DMG,
  TILE,
  WALK_SPEED,
  CLIMB_SPEED,
  WORK_DRAIN,
  BUILD_TIME,
  REFINE_TIME,
  EAT_ABOVE,
  canDig,
  isMachine,
} from "./constants";
import type {
  BuildKind,
  Cue,
  Delver,
  FxEvent,
  GameState,
  Job,
  Milestone,
  Tool,
  World,
} from "./types";
import { MODE, type ColonyMode } from "./mode";
import { generateWorld } from "./worldgen";
import { centerCameraOn, idx, tileAt } from "./world";
import { avgCo2, avgOxygen, breathableAt, breathe, lowestOxygen, stepGas } from "./gas";
import { rebuildNetworks, stepPower, type NetworkStat } from "./power";
import { bfsFrom, nearestBreathable, pathTo, standable, type Flood } from "./pathfind";
import { JobBoard, orderJobs } from "./jobs";
import {
  canAfford,
  canRefine,
  completeBuild,
  doRefine,
  farmAt,
  growFarms,
  harvest,
  makeStocks,
  placeGhost,
  refuelGenerators,
  type Stocks,
} from "./economy";
import { CAVERN } from "./worldgen";

// Sim-local timings that the survival-pressure tuning table (DESIGN §5) does not pin — kept
// here rather than in constants.ts so the core tuning surface stays exactly the specs' set.
const EAT_TIME = 1.2; // seconds a delver spends eating a ration
const HARVEST_TIME = 2.0; // seconds to harvest a ripe plot
const MILESTONE_LIFE = 4.5; // seconds a toast lingers (specs/flow.md)
const ALARM_INTERVAL = 1.6; // min seconds between low-oxygen alarm cues
const DUST_INTERVAL = 0.4; // seconds between dig-dust puffs while mining
const FALL_SPEED = 9; // tiles/s a delver falls through open space (no ladder needed down)

const DELVER_NAMES = ["VESK", "MARLOWE", "TULLY", "BRAND", "OKON", "PYE", "SERRA", "HOLT"];

export class Game {
  mode: ColonyMode;
  world: World;
  delvers: Delver[] = [];
  stocks: Stocks = makeStocks(0, 0, 0);
  jobs = new JobBoard();

  state: GameState = "title";
  speed = 1; // 1 / 2 / 3 (specs/controls.md); ticks-per-second scale lives in main.ts
  paused = false; // in-place Space pause (distinct from the Esc `paused` GameState)

  cycle = 0; // the colony's age — the primary score (specs/flow.md)
  cycleClock = 0; // seconds into the current cycle
  tilesDug = 0;
  score = 0; // finalized at loss

  // Tool / build selection (specs/controls.md). Render/input read these.
  tool: Tool = "dig";
  buildKind: BuildKind | null = null;
  buildsFirst = false; // the "builds before digs" priority toggle
  hoverTx = -1;
  hoverTy = -1;

  networks: NetworkStat[] = []; // last tick's per-network supply/demand/brownout (HUD)

  // Event queues drained by the presentation layer each frame (like valence).
  fxQueue: FxEvent[] = [];
  sndQueue: Cue[] = [];
  milestones: Milestone[] = [];

  private seed = 1;
  private nextDelverId = 1;
  private alarmTimer = 0;
  private firstDiffuser = false;
  private firstHarvest = false;

  constructor(mode: ColonyMode = MODE) {
    this.mode = mode;
    const gen = generateWorld(mode, this.seed);
    this.world = gen.world;
  }

  // ---- Lifecycle --------------------------------------------------------------
  startColony(mode: ColonyMode = this.mode, seed?: number): void {
    this.mode = mode;
    if (seed !== undefined) this.seed = seed;
    const gen = generateWorld(mode, this.seed);
    this.world = gen.world;
    this.stocks = makeStocks(mode.startOre, mode.startMaterial, mode.startFood);
    this.jobs.clear();
    this.delvers = [];
    this.nextDelverId = 1;
    for (const s of gen.spawns) this.delvers.push(this.makeDelver(s.tx, s.ty));
    this.state = "playing";
    this.paused = false;
    this.speed = 1;
    this.cycle = 0;
    this.cycleClock = 0;
    this.tilesDug = 0;
    this.score = 0;
    this.tool = "dig";
    this.buildKind = null;
    this.buildsFirst = false;
    this.alarmTimer = 0;
    this.firstDiffuser = false;
    this.firstHarvest = false;
    this.networks = [];
    this.fxQueue = [];
    this.sndQueue = [];
    this.milestones = [];
    centerCameraOn(this.world, Math.floor((CAVERN.x0 + CAVERN.x1) / 2), Math.floor((CAVERN.y0 + CAVERN.y1) / 2));
  }

  restart(): void {
    this.startColony(this.mode);
  }

  private makeDelver(tx: number, ty: number): Delver {
    const id = this.nextDelverId++;
    return {
      id,
      name: DELVER_NAMES[(id - 1) % DELVER_NAMES.length]!,
      px: (tx + 0.5) * TILE,
      py: (ty + 0.5) * TILE,
      tx,
      ty,
      facing: 1,
      health: HEALTH_MAX,
      stamina: STAMINA_MAX,
      hunger: 0,
      act: "idle",
      anim: "idle",
      animT: 0,
      job: null,
      path: [],
      pathI: 0,
      carrying: null,
      workTimer: 0,
      dead: false,
    };
  }

  // ---- Fixed simulation step --------------------------------------------------
  // Order (DESIGN §4): gas -> power -> economy (refine/grow) -> delvers -> suffocation/
  // starvation (folded into the delver step) -> cycle clock -> loss check -> milestones.
  fixedStep(dt: number): void {
    if (this.state !== "playing" || this.paused) return;

    stepGas(this.world, dt);
    this.networks = rebuildNetworks(this.world);
    stepPower(this.world, dt);
    this.noteFirstDiffuser();

    refuelGenerators(this.world, this.stocks);
    growFarms(this.world, dt);
    this.syncStandingJobs();

    for (const d of this.delvers) this.updateDelver(d, dt);

    this.cycleClock += dt;
    if (this.cycleClock >= CYCLE_SECONDS) {
      this.cycleClock -= CYCLE_SECONDS;
      this.cycle += 1;
      if (this.cycle % 5 === 0) this.toast(`${this.cycle} CYCLES SURVIVED`);
    }

    this.stepAlarm(dt);

    if (this.delvers.every((d) => d.dead)) this.lose();

    for (const m of this.milestones) m.life -= dt;
    if (this.milestones.some((m) => m.life <= 0)) this.milestones = this.milestones.filter((m) => m.life > 0);
  }

  // Keep standing refine jobs (per refinery, while ore is available) and harvest jobs (per
  // ripe farm) enqueued, so the delvers pick them up like any other work.
  private syncStandingJobs(): void {
    for (const r of this.world.refineries) {
      if (canRefine(this.stocks) && !this.jobs.has(r.tx, r.ty, "refine")) this.jobs.add("refine", r.tx, r.ty);
    }
    for (const f of this.world.farms) {
      if (f.ripe && !this.jobs.has(f.tx, f.ty, "harvest")) this.jobs.add("harvest", f.tx, f.ty);
    }
  }

  private noteFirstDiffuser(): void {
    if (this.firstDiffuser) return;
    if (this.world.machines.some((m) => m.kind === "diffuser" && m.running)) {
      this.firstDiffuser = true;
      this.toast("OXYGEN DIFFUSER ONLINE");
    }
  }

  // ---- The delver AI ----------------------------------------------------------
  // Needs preempt jobs in strict order: FLEE bad air, REST when exhausted, EAT when hungry,
  // then ordinary work from the job queue (specs/delvers.md). Environment (breathing,
  // health, hunger) is resolved first and can kill the delver this tick.
  private updateDelver(d: Delver, dt: number): void {
    if (d.dead) return;

    d.tx = Math.floor(d.px / TILE);
    d.ty = Math.floor(d.py / TILE);
    d.animT += dt;

    const tile = tileAt(this.world, d.tx, d.ty);
    const breathable = tile ? breathableAt(tile) : false;

    // Breathe: consume oxygen / exhale CO2 into the current tile.
    if (tile && (tile.kind === "open" || tile.kind === "floor" || tile.kind === "ladder" || tile.kind === "wire")) {
      breathe(tile, dt);
    }
    // Health: suffocate in bad air, recover in good air.
    if (!breathable) d.health -= SUFFOCATE_DMG * dt;
    else d.health = Math.min(HEALTH_MAX, d.health + O2_RECOVER * dt);

    // Hunger: rises over time; starve (extra health loss) at max with no food to eat.
    d.hunger = Math.min(HUNGER_MAX, d.hunger + HUNGER_RATE * dt);
    if (d.hunger >= HUNGER_MAX && this.stocks.food <= 0) d.health -= STARVE_DMG * dt;

    if (d.health <= 0) {
      this.killDelver(d);
      return;
    }

    // 0. GRAVITY: if we're not following a route and our footing was dug out from under us
    //    (mining downward), fall to the landing below. Delvers fall freely but cannot climb
    //    back up without a ladder (specs/delvers.md).
    if (d.pathI >= d.path.length && !standable(this.world, d.tx, d.ty)) {
      d.act = "walk";
      d.anim = "walk";
      if (this.fall(d, dt)) return;
      this.dropJob(d); // landed on a new tile — re-plan from here next tick
      d.path = [];
      d.pathI = 0;
      return;
    }

    // 1. FLEE bad air — top priority.
    if (!breathable) {
      if (d.act !== "flee") {
        this.dropJob(d);
        d.act = "flee";
        d.path = [];
        d.pathI = 0;
      }
      this.doFlee(d, dt);
      return;
    }
    if (d.act === "flee") {
      // Reached breathable air — resume ordinary behavior.
      d.act = "idle";
      d.path = [];
      d.pathI = 0;
    }

    // 2. REST when exhausted.
    if (d.stamina < REST_BELOW && d.act !== "rest") {
      this.dropJob(d);
      d.act = "rest";
      d.path = [];
      d.pathI = 0;
    }
    if (d.act === "rest") {
      d.stamina = Math.min(STAMINA_MAX, d.stamina + REST_RECOVER * dt);
      d.anim = "idle";
      if (d.stamina >= REST_UNTIL) d.act = "idle";
      return;
    }

    // 3. EAT when hungry and there is food.
    if (d.hunger > EAT_ABOVE && this.stocks.food > 0 && d.act !== "eat") {
      this.dropJob(d);
      d.act = "eat";
      d.workTimer = 0;
    }
    if (d.act === "eat") {
      d.anim = "idle";
      d.workTimer += dt;
      if (d.workTimer >= EAT_TIME) {
        if (this.stocks.food > 0) {
          this.stocks.food -= 1;
          d.hunger = 0;
        }
        d.act = "idle";
        d.workTimer = 0;
      }
      return;
    }

    // 4. Ordinary work.
    if (!d.job) {
      this.assignJob(d);
      if (!d.job) {
        d.act = "idle";
        d.anim = "idle";
        return;
      }
    }
    this.doJob(d, dt);
  }

  private doFlee(d: Delver, dt: number): void {
    if (d.pathI >= d.path.length) {
      const p = nearestBreathable(this.world, { tx: d.tx, ty: d.ty });
      if (p && p.length > 0) {
        d.path = p;
        d.pathI = 0;
      } else {
        // No reachable air — the delver suffocates where it stands (the colony's death).
        d.anim = "idle";
        return;
      }
    }
    d.anim = "walk";
    this.advance(d, dt);
  }

  // Pick the highest-priority reachable+doable job, claim it, and route to its stand tile.
  private assignJob(d: Delver): void {
    if (!standable(this.world, d.tx, d.ty)) return; // mid-fall; try again next tick
    const flood = bfsFrom(this.world, d.tx, d.ty);
    for (const job of orderJobs(this.jobs.list, this.buildsFirst)) {
      if (job.claimedBy !== null) continue;
      if (!this.jobAffordable(job)) continue;
      const stand = this.standTileFor(job, flood);
      if (stand === null) continue;
      const path = pathTo(flood, stand, this.world.w);
      if (path === null) continue;
      job.claimedBy = d.id;
      d.job = job;
      d.path = path;
      d.pathI = 0;
      d.workTimer = 0;
      return;
    }
  }

  private jobAffordable(job: Job): boolean {
    if (job.kind === "build") return job.building ? canAfford(this.stocks, job.building) : false;
    if (job.kind === "refine") return canRefine(this.stocks);
    return true;
  }

  // The BFS-nearest standable tile a delver works `job` from: a floor/ladder/wire build can
  // be stood on directly; everything else is worked from a standable 4-neighbor (delvers
  // dig/build inward from open space, specs/world.md).
  private standTileFor(job: Job, flood: Flood): number | null {
    const cands = new Set<number>();
    const onTile = job.kind === "build" && (job.building === "floor" || job.building === "ladder" || job.building === "wire");
    if (onTile && standable(this.world, job.tx, job.ty)) cands.add(idx(this.world.w, job.tx, job.ty));
    for (const [nx, ny] of [
      [job.tx - 1, job.ty],
      [job.tx + 1, job.ty],
      [job.tx, job.ty - 1],
      [job.tx, job.ty + 1],
    ] as const) {
      if (standable(this.world, nx, ny)) cands.add(idx(this.world.w, nx, ny));
    }
    for (const n of flood.order) if (cands.has(n)) return n;
    return null;
  }

  private doJob(d: Delver, dt: number): void {
    const job = d.job!;
    // Walk to the stand tile first.
    if (d.pathI < d.path.length) {
      d.act = "walk";
      d.anim = d.carrying ? "carry" : "walk";
      this.advance(d, dt);
      return;
    }

    // Arrived — perform the work, draining stamina.
    d.stamina = Math.max(0, d.stamina - WORK_DRAIN * dt);
    d.workTimer += dt;

    switch (job.kind) {
      case "dig": {
        d.act = "dig";
        d.anim = "dig";
        this.facingToward(d, job.tx);
        const tile = tileAt(this.world, job.tx, job.ty);
        if (!tile || !canDig(tile.kind)) {
          this.finishJob(d, job);
          return;
        }
        // Dig dust puffs while mining (specs/assets.md).
        if (Math.floor((d.workTimer - dt) / DUST_INTERVAL) !== Math.floor(d.workTimer / DUST_INTERVAL)) {
          this.pushFx("dust", job.tx, job.ty);
        }
        const need = DIG_TIME[tile.kind as "dirt" | "ore" | "rock"];
        if (d.workTimer >= need) this.completeDig(d, job);
        break;
      }
      case "build": {
        d.act = "build";
        d.anim = "carry";
        d.carrying = "material";
        this.facingToward(d, job.tx);
        if (d.workTimer >= BUILD_TIME) {
          if (job.building && canAfford(this.stocks, job.building)) {
            completeBuild(this.world, this.stocks, job.tx, job.ty);
            this.pushSnd("build");
          }
          d.carrying = null;
          this.finishJob(d, job);
        }
        break;
      }
      case "refine": {
        d.act = "refine";
        d.anim = "carry";
        d.carrying = "ore";
        this.facingToward(d, job.tx);
        if (d.workTimer >= REFINE_TIME) {
          doRefine(this.stocks);
          d.carrying = null;
          this.finishJob(d, job);
        }
        break;
      }
      case "harvest": {
        d.act = "harvest";
        d.anim = "carry";
        d.carrying = "food";
        this.facingToward(d, job.tx);
        if (d.workTimer >= HARVEST_TIME) {
          const farm = farmAt(this.world, job.tx, job.ty);
          if (farm && farm.ripe) {
            harvest(this.stocks, farm);
            if (!this.firstHarvest) {
              this.firstHarvest = true;
              this.toast("FIRST HARVEST");
            }
          }
          d.carrying = null;
          this.finishJob(d, job);
        }
        break;
      }
      default: {
        this.finishJob(d, job);
        break;
      }
    }
  }

  private completeDig(d: Delver, job: Job): void {
    const tile = tileAt(this.world, job.tx, job.ty)!;
    const oreGained = tile.kind === "ore" ? Math.max(1, tile.oreRich) : 0;
    if (oreGained > 0) this.stocks.ore += oreGained;
    tile.kind = "open";
    tile.designated = false;
    tile.oreRich = 0;
    tile.oxygen = 0; // freshly opened space — diffusion fills it from its neighbors
    tile.co2 = 0;
    this.tilesDug += 1;
    this.pushFx("dust", job.tx, job.ty);
    this.pushSnd("dig");
    d.carrying = null;
    this.finishJob(d, job);
  }

  private finishJob(d: Delver, job: Job): void {
    this.jobs.remove(job);
    d.job = null;
    d.workTimer = 0;
    d.act = "idle";
  }

  private dropJob(d: Delver): void {
    if (d.job) {
      this.jobs.releaseClaimsOf(d.id);
      d.job = null;
    }
    d.workTimer = 0;
    d.carrying = null;
  }

  private killDelver(d: Delver): void {
    d.dead = true;
    d.health = 0;
    d.act = "idle";
    this.dropJob(d);
    this.pushSnd("alarm");
  }

  // Move continuously along the hop path; ladders/vertical steps use the climb speed.
  private advance(d: Delver, dt: number): void {
    if (d.pathI >= d.path.length) return;
    const node = d.path[d.pathI]!;
    const cx = (node.tx + 0.5) * TILE;
    const cy = (node.ty + 0.5) * TILE;
    const dx = cx - d.px;
    const dy = cy - d.py;
    const dist = Math.hypot(dx, dy);
    const vertical = Math.abs(dy) > Math.abs(dx);
    const speed = (vertical ? CLIMB_SPEED : WALK_SPEED) * TILE;
    const step = speed * dt;
    if (Math.abs(dx) > 0.5) d.facing = dx > 0 ? 1 : -1;
    if (dist <= step || dist === 0) {
      d.px = cx;
      d.py = cy;
      d.pathI += 1;
    } else {
      d.px += (dx / dist) * step;
      d.py += (dy / dist) * step;
    }
    d.tx = Math.floor(d.px / TILE);
    d.ty = Math.floor(d.py / TILE);
  }

  // Fall straight down to the first standable tile at or below the delver. Returns true
  // while still airborne this tick.
  private fall(d: Delver, dt: number): boolean {
    let ly = d.ty;
    while (ly < this.world.h - 1 && !standable(this.world, d.tx, ly)) ly++;
    const targetY = (ly + 0.5) * TILE;
    const step = FALL_SPEED * TILE * dt;
    if (d.py + step >= targetY) {
      d.py = targetY;
      d.ty = Math.floor(d.py / TILE);
      return false;
    }
    d.py += step;
    d.ty = Math.floor(d.py / TILE);
    return true;
  }

  private facingToward(d: Delver, tx: number): void {
    const cx = (tx + 0.5) * TILE;
    if (Math.abs(cx - d.px) > 0.5) d.facing = cx > d.px ? 1 : -1;
  }

  // ---- Alarm / milestones -----------------------------------------------------
  private stepAlarm(dt: number): void {
    this.alarmTimer = Math.max(0, this.alarmTimer - dt);
    const suffocating = this.delvers.some((d) => {
      if (d.dead) return false;
      const t = tileAt(this.world, d.tx, d.ty);
      return !t || !breathableAt(t);
    });
    const starving = this.stocks.food <= 0 && this.delvers.some((d) => !d.dead && d.hunger >= HUNGER_MAX);
    if ((suffocating || starving) && this.alarmTimer <= 0) {
      this.pushSnd("alarm");
      this.alarmTimer = ALARM_INTERVAL;
    }
  }

  private toast(text: string): void {
    this.milestones.push({ text, life: MILESTONE_LIFE });
  }

  private pushFx(kind: "dust" | "steam", tx: number, ty: number): void {
    this.fxQueue.push({ kind, x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE });
  }
  private pushSnd(cue: Cue): void {
    this.sndQueue.push(cue);
  }

  private lose(): void {
    this.state = "gameover";
    this.score = this.cycle;
  }

  // ---- Player tools (specs/controls.md) — routed from src/input.ts -------------
  // Mark a solid, non-bedrock tile for digging; enqueue a dig job (deduped).
  markDig(tx: number, ty: number): void {
    if (this.state !== "playing") return;
    const t = tileAt(this.world, tx, ty);
    if (!t || !canDig(t.kind) || t.designated) return;
    t.designated = true;
    this.jobs.add("dig", tx, ty);
  }

  // Mark a rectangle of tiles for digging (the drag gesture / dev hook).
  markDigRect(tx0: number, ty0: number, tx1: number, ty1: number): void {
    const x0 = Math.min(tx0, tx1);
    const x1 = Math.max(tx0, tx1);
    const y0 = Math.min(ty0, ty1);
    const y1 = Math.max(ty0, ty1);
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) this.markDig(tx, ty);
  }

  // Place a build ghost + enqueue its build job (refused if the placement is illegal).
  placeBuild(tx: number, ty: number, kind: BuildKind): boolean {
    if (this.state !== "playing") return false;
    if (!placeGhost(this.world, tx, ty, kind)) return false;
    this.jobs.add("build", tx, ty, kind);
    return true;
  }

  // Clear a dig designation or a build ghost at a tile, and free any delver that claimed it.
  cancelAt(tx: number, ty: number): void {
    if (this.state !== "playing") return;
    const t = tileAt(this.world, tx, ty);
    if (!t) return;
    if (t.designated) t.designated = false;
    if (t.ghost !== null) {
      t.ghost = null;
      t.ghostPaid = false;
    }
    const removed = this.jobs.cancelAt(tx, ty);
    for (const job of removed) {
      if (job.claimedBy !== null) {
        const d = this.delvers.find((x) => x.id === job.claimedBy);
        if (d) {
          d.job = null;
          d.path = [];
          d.pathI = 0;
          d.act = "idle";
          d.carrying = null;
        }
      }
    }
  }

  // Raise a specific designation's priority ("do this now", specs/controls.md).
  boostAt(tx: number, ty: number): void {
    for (const j of this.jobs.list) if (j.tx === tx && j.ty === ty) j.priorityBoost = true;
  }

  // ---- Tool / speed / pause / menu controls -----------------------------------
  setTool(tool: Tool): void {
    this.tool = tool;
    if (tool !== "build") this.buildKind = null;
  }
  selectBuild(kind: BuildKind): void {
    this.tool = "build";
    this.buildKind = kind;
  }
  togglePriority(): void {
    this.buildsFirst = !this.buildsFirst;
  }
  setSpeed(n: number): void {
    this.speed = n < 1 ? 1 : n > 3 ? 3 : Math.round(n);
  }
  cycleSpeed(): void {
    this.speed = this.speed >= 3 ? 1 : this.speed + 1;
  }
  togglePause(): void {
    if (this.state === "playing") this.paused = !this.paused;
  }
  openMenu(): void {
    if (this.state === "playing") this.state = "paused";
  }
  resumeMenu(): void {
    if (this.state === "paused") this.state = "playing";
  }
  toMenu(): void {
    this.state = "title";
  }
  setHover(tx: number, ty: number): void {
    this.hoverTx = tx;
    this.hoverTy = ty;
  }

  // ---- Derived reads for the HUD ----------------------------------------------
  get living(): Delver[] {
    return this.delvers.filter((d) => !d.dead);
  }
  oxygenAvg(): number {
    return avgOxygen(this.world);
  }
  oxygenLow(): number {
    return lowestOxygen(this.world);
  }
  co2Avg(): number {
    return avgCo2(this.world);
  }
  get brownout(): boolean {
    return this.networks.some((n) => n.brownout);
  }
  // The running machines' vent positions (world-px), for the looping steam fx in main.ts.
  runningVents(): { id: number; x: number; y: number }[] {
    const out: { id: number; x: number; y: number }[] = [];
    for (const m of this.world.machines) {
      if (m.running) out.push({ id: m.id, x: (m.tx + 0.5) * TILE, y: (m.ty + 0.5) * TILE });
    }
    return out;
  }
  anyMachineRunning(): boolean {
    return this.world.machines.some((m) => m.running);
  }

  // ---- Dev / proof hooks (also the balance-harness control surface, DESIGN §8) --
  // Grant resources for a scripted scene.
  grant(g: { ore?: number; material?: number; food?: number }): void {
    if (g.ore) this.stocks.ore += g.ore;
    if (g.material) this.stocks.material += g.material;
    if (g.food) this.stocks.food += g.food;
  }
  // Flood every open tile with a given oxygen level (proof: a breathable colony).
  fillCavern(o2: number): void {
    for (const t of this.world.tiles) {
      if (t.kind === "open" || t.kind === "floor" || t.kind === "ladder" || t.kind === "wire" || (isMachine(t.kind) && t.kind !== "wall")) {
        t.oxygen = o2;
        t.co2 = 0;
      }
    }
  }
  // Prime the game-over path: no oxygen generation, thin the pocket so the crew spends it
  // fast and suffocates (proof: reach the colony-lost screen quickly).
  sealAndSpend(): void {
    for (const t of this.world.tiles) {
      if (t.kind === "open" || t.kind === "floor" || t.kind === "ladder" || t.kind === "wire") {
        t.oxygen = Math.min(t.oxygen, 28);
        t.co2 = 0;
      }
    }
  }
  // Instantly open a rectangle of tiles (dev scene geometry, bypassing the dig labor).
  devDigRect(tx0: number, ty0: number, tx1: number, ty1: number): void {
    const x0 = Math.min(tx0, tx1);
    const x1 = Math.max(tx0, tx1);
    const y0 = Math.min(ty0, ty1);
    const y1 = Math.max(ty0, ty1);
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const t = tileAt(this.world, tx, ty);
        if (t && canDig(t.kind)) {
          if (t.kind === "ore") this.stocks.ore += Math.max(1, t.oreRich);
          t.kind = "open";
          t.designated = false;
          t.oreRich = 0;
          this.tilesDug += 1;
        }
      }
    }
  }
  // Instantly finish a build at a tile (dev scene: machines present so a diffuser can run).
  devPlace(kind: BuildKind, tx: number, ty: number): boolean {
    if (!placeGhost(this.world, tx, ty, kind)) return false;
    if (!canAfford(this.stocks, kind)) this.stocks.material += 999; // dev: never blocked
    completeBuild(this.world, this.stocks, tx, ty);
    return true;
  }
  // Run n fixed steps at FIXED_STEP (proof/harness stepping).
  tick(n: number, dt: number): void {
    for (let i = 0; i < n; i++) this.fixedStep(dt);
  }
}
