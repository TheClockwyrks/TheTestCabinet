// Floe — the game: the state machine, the crossing flow, and the fixed-step
// simulation (specs/gameplay.md). Rendering lives in render.ts and reads this object's
// public fields. main.ts drives it: once-per-frame edge input via handleInput(),
// then fixed-timestep physics via fixedStep().

import { Audio } from "./audio";
import {
  BAY_COUNT,
  BAYFILL_PAUSE,
  BEAR_CATCH_DIST,
  BEAR_EMERGE_ADVANCE,
  BEAR_EMERGE_DELAY,
  BEAR_ICE_SPEED,
  BEAR_SECOND_DELAY,
  BEAR_SPEED_STEP,
  BEAR_SWIM_SPEED,
  CLEAR_PAUSE,
  COLOR,
  DEATH_PAUSE,
  FISH_INTERVAL,
  FISH_LINGER,
  HOP_COOLDOWN,
  ROW_NEAR,
  SCORE_BAY,
  SCORE_BONUS_CATCH,
  SCORE_BONUS_LIFE,
  SCORE_LEVEL,
  SCORE_ROW,
  SCORE_TIME_BONUS,
  SCORE_VICTORY_LIFE,
  SECOND_BEAR_LEVEL,
  START_LIVES,
  STRAIT_W,
  TILE,
  TIMER_BASE,
  TIMER_MIN,
  TIMER_PER_LEVEL,
  TOTAL_LEVELS,
} from "./constants";
import { Bear, Critter } from "./entities";
import {
  bayIndexAtCol,
  clampCol,
  colToX,
  isIceRow,
  isWaterRow,
  rowToY,
  xToCol,
} from "./grid";
import { chooseBearStep, type Tile, type WorldView } from "./hunter";
import {
  buildLevelLanes,
  laneItemLen,
  laneKindForRow,
  laneVelocity,
  updateLane,
  type LevelLanes,
} from "./lanes";
import {
  Input,
  dirOf,
  isBack,
  isConfirm,
  isMenuDown,
  isMenuUp,
  isMute,
  isPause,
} from "./input";
import type {
  AppState,
  Dir,
  Floe,
  FloeKind,
  Lane,
  Phase,
  Vehicle,
  VehicleKind,
} from "./types";
import { DIR_VEC } from "./types";

// A tiny seedable PRNG (mulberry32). The game's only nondeterministic choice is
// which open bay the bonus-catch fish appears in; routing it through a seeded
// generator (reseeded by the debug API's reset) makes a scenario replay
// identically. See specs/instrumentation.md.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function (): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const TITLE_ITEMS = ["CROSS", "HOW TO PLAY"];
export const PAUSE_ITEMS = ["RESUME", "RESTART", "QUIT TO MENU"];
export const OVER_ITEMS = ["PLAY AGAIN", "MENU"];

// A hunter slot: a bear (once emerged) plus its emerge gating.
interface Hunter {
  bear: Bear | null;
  emergeDelay: number; // seconds remaining before it may emerge
  emergeAdvance: number; // rows the critter must have advanced first
}

export interface Splash {
  x: number; // strait-local center px
  y: number;
  age: number;
  color: string;
}

export class Game implements WorldView {
  readonly input: Input;
  readonly audio = new Audio();

  state: AppState = "title";
  phase: Phase = "crossing";
  menuIndex = 0;
  simTime = 0;

  // Run state.
  level = 1;
  lives = START_LIVES;
  score = 0;
  timer = TIMER_BASE;
  timerMax = TIMER_BASE;
  bays: boolean[] = new Array(BAY_COUNT).fill(false);

  // Bonus life: a life is awarded each time the score crosses a SCORE_BONUS_LIFE
  // (10,000-point) milestone. This is the next milestone still to be reached.
  private nextBonusLife = SCORE_BONUS_LIFE;

  // Bonus catch: a fish sits in one open bay for FISH_LINGER seconds, then a new
  // one appears in another open bay (about every FISH_INTERVAL seconds). Landing a
  // crossing in the bay that holds it scores SCORE_BONUS_CATCH. Purely cosmetic /
  // score — it never affects lives, the timer, or level progression.
  fishBay: number | null = null; // the open bay currently holding the fish, or null
  private fishLinger = 0; // seconds the current fish keeps lingering
  private fishTimer = FISH_INTERVAL; // seconds until the next fish appears (none out)
  private lastFishBay = -1; // the bay the previous fish used (so it moves elsewhere)

  // World.
  lanes: LevelLanes = buildLevelLanes(1);
  readonly critter = new Critter();
  hunters: Hunter[] = [];
  splashes: Splash[] = [];

  // Per-crossing bookkeeping.
  private bestRow = ROW_NEAR; // lowest (highest-up) row reached this crossing
  private hopCooldown = 0;
  private pendingDir: Dir | null = null;

  // Phase timers.
  private deathTimer = 0;
  private clearTimer = 0;
  private bayfillTimer = 0;

  // Result bookkeeping for the end screens.
  levelReached = 1;
  muteFlash = 0;

  // Seeded randomness. Only the bonus-catch fish's bay choice is random; it runs
  // off this generator so reseeding (debug reset) reproduces the same sequence.
  private seed = 1;
  private rng: () => number = mulberry32(this.seed);

  // Debug / automation state (see debug.ts; inert in normal play). When on,
  // render.ts draws the read-only debug overlay. Toggled with the backtick key.
  debugOverlay = false;

  // Who advances the simulation. When true (the default, and the whole of normal
  // play), main.ts's animation loop advances the sim from the wall clock. The
  // debug API flips it false to drive the clock itself with step(ticks), so a
  // scripted scenario advances by exactly what it asks for — no stray wall-clock
  // frames sneak in between calls (see debug.ts and specs/instrumentation.md).
  autoStep = true;

  // Whether the hunter's pursuit brain is running (specs/instrumentation.md's
  // setBearAI). When off the bears stop deciding and moving and hold whatever
  // position they are in; everything the world does TO a bear is untouched — a
  // sliding hazard still resets it, the water still carries or submerges it, it
  // still catches a critter that reaches it, and a reset bear still re-emerges.
  bearAI = true;

  constructor(input: Input) {
    this.input = input;
    this.input.onFirstPress(() => this.audio.resume());
    this.toTitle();
  }

  // ---- WorldView (for the hunter's pathfinding) -------------------------

  // Exact coverage — used to actually knock the bear out when caught in traffic.
  // Did a vehicle's OWN MOTION bring it onto this ice tile during the step just
  // taken? Lanes are advanced before the hunters each step, so a vehicle's previous
  // position is its current one less the lane's travel over `dt` — no extra state
  // needed. A parked lane travels nothing, so a vehicle that was already on the tile
  // still is, and this reads false.
  //
  // This is what separates a vehicle sliding INTO the bear from a bear travelling
  // onto a vehicle (specs/hunter.md): only the former resets it, exactly as a critter
  // is refused rather than killed for moving into traffic (specs/hazards.md). In a
  // head-on meeting both are moving and the vehicle still newly covers the tile, so
  // luring the bear into traffic works exactly as before.
  vehicleMovedOnto(col: number, row: number, dt: number): boolean {
    const lane = this.iceLaneForRow(row);
    if (!lane) return false;
    const left = col * TILE;
    const right = left + TILE;
    const travel = lane.dir * lane.speed * TILE * dt;
    for (const v of lane.items) {
      const coversNow = v.x < right && v.x + v.len * TILE > left;
      if (!coversNow) continue;
      const was = v.x - travel;
      const coveredBefore = was < right && was + v.len * TILE > left;
      if (!coveredBefore) return true;
    }
    return false;
  }

  vehicleCovers(col: number, row: number): boolean {
    const lane = this.iceLaneForRow(row);
    if (!lane) return false;
    const left = col * TILE;
    const right = left + TILE;
    for (const v of lane.items) {
      if (v.x < right && v.x + v.len * TILE > left) return true;
    }
    return false;
  }

  // Does a vehicle sit on this ice tile right now (with a small inset, so a vehicle
  // barely grazing the tile edge does not count)? Used both to refuse a critter hop
  // ONTO an occupied tile and to crush a critter a vehicle slides INTO.
  private vehicleAtTile(col: number, row: number): boolean {
    const lane = this.iceLaneForRow(row);
    if (!lane) return false;
    const left = col * TILE + 5;
    const right = col * TILE + TILE - 5;
    for (const v of lane.items) {
      if (v.x < right && v.x + v.len * TILE > left) return true;
    }
    return false;
  }

  // A tile the critter may not hop ONTO because a vehicle occupies it (an ice tile
  // under traffic). The hop is refused like a wall — no move, no death.
  private blockedByVehicle(col: number, row: number): boolean {
    return isIceRow(row) && this.vehicleAtTile(col, row);
  }

  // Coverage plus a safety buffer ahead of each vehicle (a hop's worth of travel),
  // so the bear's pathfinder gives moving traffic room instead of stepping in
  // front of it. WorldView method used only by the hunter.
  vehicleThreatens(col: number, row: number): boolean {
    const lane = this.iceLaneForRow(row);
    if (!lane) return false;
    const left = col * TILE;
    const right = left + TILE;
    const margin = Math.max(20, lane.speed * TILE * 0.35);
    for (const v of lane.items) {
      // Extend the vehicle's covered span forward along its travel direction.
      const lo = lane.dir < 0 ? v.x - margin : v.x;
      const hi = lane.dir < 0 ? v.x + v.len * TILE : v.x + v.len * TILE + margin;
      if (lo < right && hi > left) return true;
    }
    return false;
  }

  private hasFloe(col: number, row: number): boolean {
    const lane = this.waterLaneForRow(row);
    if (!lane) return false;
    const c = col * TILE + TILE / 2;
    return this.floeUnder(lane, c) !== null;
  }

  private iceLaneForRow(row: number): Lane<Vehicle> | null {
    for (const lane of this.lanes.ice) if (lane.row === row) return lane;
    return null;
  }
  private waterLaneForRow(row: number): Lane<Floe> | null {
    for (const lane of this.lanes.water) if (lane.row === row) return lane;
    return null;
  }

  // The floe under a strait-local center-x in a water lane, or null (open water).
  private floeUnder(lane: Lane<Floe>, centerX: number): Floe | null {
    const inset = 4;
    for (const f of lane.items) {
      if (centerX >= f.x + inset && centerX <= f.x + f.len * TILE - inset) {
        return f;
      }
    }
    return null;
  }

  // ---- State transitions ------------------------------------------------

  private toTitle(): void {
    this.state = "title";
    this.menuIndex = 0;
    this.level = 1;
    this.lanes = buildLevelLanes(1);
    this.bays.fill(false);
    this.resetFish();
    // Atmosphere: a resting critter on the near shore, a swimming bear behind it.
    this.critter.place(20, ROW_NEAR);
    this.hunters = [{ bear: new Bear(7, 6), emergeDelay: 0, emergeAdvance: 0 }];
    this.hunters[0].bear!.swimming = true;
    this.splashes = [];
  }

  private startGame(): void {
    this.lives = START_LIVES;
    this.score = 0;
    this.nextBonusLife = SCORE_BONUS_LIFE;
    this.level = 1;
    this.levelReached = 1;
    this.startLevel();
    this.state = "playing";
  }

  private startLevel(): void {
    this.levelReached = this.level;
    this.lanes = buildLevelLanes(this.level);
    this.bays.fill(false);
    this.resetFish();
    this.timerMax = this.levelTimer();
    this.newCrossing();
  }

  private levelTimer(): number {
    return Math.max(TIMER_MIN, TIMER_BASE - (this.level - 1) * TIMER_PER_LEVEL);
  }

  // Begin a fresh crossing from the near shore (start of level, or after a death
  // or a filled bay). Bays are preserved; the hunters reset and re-emerge only
  // after the fresh critter has advanced a few tiles.
  private newCrossing(): void {
    this.critter.place(20, ROW_NEAR);
    this.bestRow = ROW_NEAR;
    this.timer = this.timerMax;
    this.hopCooldown = 0;
    this.pendingDir = null;
    this.phase = "crossing";
    const count = this.level >= SECOND_BEAR_LEVEL ? 2 : 1;
    this.hunters = [];
    for (let i = 0; i < count; i++) {
      this.hunters.push({
        bear: null,
        emergeDelay: BEAR_EMERGE_DELAY + i * BEAR_SECOND_DELAY,
        emergeAdvance: BEAR_EMERGE_ADVANCE + i * 3,
      });
    }
  }

  private die(splashColor: string): void {
    if (this.phase !== "crossing") return;
    this.lives -= 1;
    this.phase = "dying";
    this.deathTimer = DEATH_PAUSE;
    this.splashes.push({
      x: this.critter.rx + TILE / 2,
      y: this.critter.ry + TILE / 2,
      age: 0,
      color: splashColor,
    });
    for (const h of this.hunters) h.bear = null;
  }

  private fillBay(index: number): void {
    this.bays[index] = true;
    const timeBonus = Math.floor(this.timer) * SCORE_TIME_BONUS;
    let gained = SCORE_BAY + timeBonus;
    if (this.fishBay === index) {
      // Landed in the bay holding the bonus-catch fish; take it and clear the fish
      // (its bay is now filled).
      gained += SCORE_BONUS_CATCH;
      this.clearFish();
    }
    this.addScore(gained);
    this.audio.bay();
    const filled = this.bays.filter(Boolean).length;
    for (const h of this.hunters) h.bear = null;
    if (filled >= BAY_COUNT) {
      this.clearLevel();
    } else {
      this.phase = "clearing"; // brief settle handled by bayfillTimer
      this.bayfillTimer = BAYFILL_PAUSE;
    }
  }

  private clearLevel(): void {
    this.addScore(SCORE_LEVEL * this.level);
    if (this.level >= TOTAL_LEVELS) {
      this.addScore(SCORE_VICTORY_LIFE * this.lives);
      this.audio.victory();
      this.state = "victory";
      this.menuIndex = 0;
      return;
    }
    this.audio.levelClear();
    this.phase = "clearing";
    this.clearTimer = CLEAR_PAUSE;
  }

  private gameOver(): void {
    this.audio.gameOver();
    this.state = "gameover";
    this.menuIndex = 0;
  }

  private pause(): void {
    this.state = "paused";
    this.menuIndex = 0;
  }

  // ---- Edge input (once per frame) --------------------------------------

  handleInput(): void {
    for (const code of this.input.drain()) {
      if (isMute(code)) {
        this.audio.toggleMute();
        this.muteFlash = 1.2;
        continue;
      }
      if (code === "Backquote") {
        // Toggle the read-only debug overlay (see render.ts). Never touches
        // gameplay.
        this.debugOverlay = !this.debugOverlay;
        continue;
      }
      switch (this.state) {
        case "title":
          this.menuInput(code, TITLE_ITEMS.length, (i) => this.selectTitle(i));
          break;
        case "howto":
          if (isConfirm(code) || isBack(code)) {
            this.state = "title";
            this.menuIndex = 0;
          }
          break;
        case "playing":
          if (isPause(code)) {
            this.pause();
          } else if (this.phase === "crossing") {
            const d = dirOf(code);
            if (d) this.pendingDir = d;
          }
          break;
        case "paused":
          if (isBack(code)) {
            this.state = "playing";
          } else {
            this.menuInput(code, PAUSE_ITEMS.length, (i) => this.selectPause(i));
          }
          break;
        case "victory":
        case "gameover":
          this.menuInput(code, OVER_ITEMS.length, (i) => this.selectOver(i));
          break;
      }
    }
  }

  private menuInput(
    code: string,
    count: number,
    onConfirm: (index: number) => void,
  ): void {
    if (isMenuUp(code)) {
      this.menuIndex = (this.menuIndex + count - 1) % count;
    } else if (isMenuDown(code)) {
      this.menuIndex = (this.menuIndex + 1) % count;
    } else if (isConfirm(code)) {
      onConfirm(this.menuIndex);
    }
  }

  private selectTitle(i: number): void {
    if (i === 0) this.startGame();
    else this.state = "howto";
  }
  private selectPause(i: number): void {
    if (i === 0) this.state = "playing";
    else if (i === 1) this.startGame();
    else this.toTitle();
  }
  private selectOver(i: number): void {
    if (i === 0) this.startGame();
    else this.toTitle();
  }

  // ---- Fixed-timestep update --------------------------------------------

  fixedStep(dt: number): void {
    this.simTime += dt;
    if (this.muteFlash > 0) this.muteFlash = Math.max(0, this.muteFlash - dt);
    this.updateSplashes(dt);

    if (this.state === "title") {
      this.updateLanes(dt);
      this.critter.advance(dt);
      this.animateTitleBear();
      return;
    }
    if (this.state !== "playing") return;

    if (this.phase === "dying") {
      this.updateSplashOnlyWorld(dt);
      this.deathTimer -= dt;
      if (this.deathTimer <= 0) {
        if (this.lives <= 0) this.gameOver();
        else this.newCrossing();
      }
      return;
    }
    if (this.phase === "clearing") {
      this.updateLanes(dt);
      this.critter.advance(dt);
      if (this.bayfillTimer > 0) {
        this.bayfillTimer -= dt;
        if (this.bayfillTimer <= 0) this.newCrossing();
      } else if (this.clearTimer > 0) {
        this.clearTimer -= dt;
        if (this.clearTimer <= 0) {
          this.level += 1;
          this.startLevel();
        }
      }
      return;
    }

    // ---- phase === "crossing" -------------------------------------------
    this.updateLanes(dt);
    this.updateFish(dt);
    this.processHop(dt);
    if (this.phase !== "crossing") return; // a hop may have filled a bay
    this.updateCritterFooting(dt);
    if (this.phase !== "crossing") return;
    this.updateHunters(dt);
    if (this.phase !== "crossing") return;

    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = 0;
      this.die(COLOR.critter);
    }
    this.critter.advance(dt);
  }

  private updateLanes(dt: number): void {
    for (const lane of this.lanes.ice) updateLane(lane, dt);
    for (const lane of this.lanes.water) updateLane(lane, dt);
  }

  private updateSplashOnlyWorld(dt: number): void {
    // During the death pause the lanes keep sliding so the scene still feels
    // alive, but nothing can collide (the critter is gone).
    this.updateLanes(dt);
    this.critter.advance(dt);
  }

  private updateSplashes(dt: number): void {
    for (const s of this.splashes) s.age += dt;
    this.splashes = this.splashes.filter((s) => s.age < 0.7);
  }

  // Apply at most one hop this step, gated by the cooldown; held keys auto-repeat.
  private processHop(dt: number): void {
    if (this.hopCooldown > 0) this.hopCooldown -= dt;
    let dir: Dir | null = this.pendingDir;
    this.pendingDir = null;
    if (!dir) dir = this.input.heldDir();
    if (!dir || this.hopCooldown > 0) return;
    if (this.doHop(dir)) {
      this.hopCooldown = HOP_COOLDOWN;
    }
  }

  // Attempt a one-tile hop. Returns true if the critter moved (or filled a bay).
  private doHop(dir: Dir): boolean {
    const { dc, dr } = DIR_VEC[dir];
    const c = this.critter;

    if (dr === 0) {
      // Horizontal: one absolute tile; refuse if it would leave the strait or land
      // on a tile a vehicle already occupies (you cannot step into traffic).
      const nx = c.x + dc * TILE;
      const center = nx + TILE / 2;
      if (center < 0 || center > STRAIT_W) return false;
      if (this.blockedByVehicle(xToCol(nx), c.row)) return false;
      c.x = nx;
      c.startHop(dir);
      this.audio.hop();
      return true;
    }

    const nr = c.row + dr;
    if (dir === "down") {
      if (nr > ROW_NEAR) return false; // below the near shore
      if (this.blockedByVehicle(c.col(), nr)) return false; // occupied ice tile
      c.row = nr;
      c.startHop(dir);
      this.audio.hop();
      return true;
    }

    // dir === "up"
    if (nr < 0) return false;
    if (nr === 1) {
      // Into the far-shore row: only an open bay is enterable.
      const col = xToCol(c.x);
      const bay = bayIndexAtCol(col);
      if (bay < 0 || this.bays[bay]) return false; // solid shore or filled bay
      this.scoreRowAdvance(nr);
      c.place(col, nr);
      this.fillBay(bay);
      return true;
    }
    if (this.blockedByVehicle(c.col(), nr)) return false; // occupied ice tile
    c.row = nr;
    c.startHop(dir);
    this.audio.hop();
    this.scoreRowAdvance(nr);
    return true;
  }

  private scoreRowAdvance(newRow: number): void {
    if (newRow < this.bestRow) {
      this.addScore((this.bestRow - newRow) * SCORE_ROW);
      this.bestRow = newRow;
    }
  }

  // Add to the score and award a bonus life for each SCORE_BONUS_LIFE (10,000-point)
  // milestone the score newly crosses (a big single gain can cross more than one).
  private addScore(points: number): void {
    this.score += points;
    while (this.score >= this.nextBonusLife) {
      this.lives += 1;
      this.nextBonusLife += SCORE_BONUS_LIFE;
      this.audio.bonusLife();
    }
  }

  // ---- The bonus catch (a fish in an open bay) --------------------------

  // Advance the fish: it lingers in its bay for FISH_LINGER seconds (or until that
  // bay is filled), then a new one appears in another open bay about every
  // FISH_INTERVAL seconds. Never touches lives, the timer, or level progression.
  private updateFish(dt: number): void {
    if (this.fishBay !== null) {
      if (this.bays[this.fishBay]) {
        this.clearFish(); // its bay was filled — remove it, schedule the next
        return;
      }
      this.fishLinger -= dt;
      if (this.fishLinger <= 0) this.clearFish();
      return;
    }
    this.fishTimer -= dt;
    if (this.fishTimer <= 0) this.spawnFish();
  }

  // Place a fish in a random open bay, preferring one it did not just leave. With no
  // open bay, nothing shows and it retries shortly.
  private spawnFish(): void {
    const open: number[] = [];
    for (let i = 0; i < this.bays.length; i++) if (!this.bays[i]) open.push(i);
    if (open.length === 0) {
      this.fishTimer = FISH_INTERVAL;
      return;
    }
    const choices =
      open.length > 1 ? open.filter((i) => i !== this.lastFishBay) : open;
    const pick = choices[Math.floor(this.rng() * choices.length)];
    this.fishBay = pick;
    this.lastFishBay = pick;
    this.fishLinger = FISH_LINGER;
  }

  // Remove the current fish and schedule the next appearance so successive fish
  // arrive about FISH_INTERVAL apart (it has already lingered FISH_LINGER).
  private clearFish(): void {
    this.fishBay = null;
    this.fishLinger = 0;
    this.fishTimer = Math.max(0, FISH_INTERVAL - FISH_LINGER);
  }

  // Full reset (start of level / title): no fish out, first one after ~FISH_INTERVAL.
  private resetFish(): void {
    this.fishBay = null;
    this.fishLinger = 0;
    this.fishTimer = FISH_INTERVAL;
    this.lastFishBay = -1;
  }

  // Water carry, drowning, and off-edge death; ice-band crushing.
  private updateCritterFooting(dt: number): void {
    const c = this.critter;
    if (isWaterRow(c.row)) {
      const lane = this.waterLaneForRow(c.row)!;
      const floe = this.floeUnder(lane, c.centerX());
      if (!floe) {
        this.audio.splash();
        this.die(COLOR.splash);
        return;
      }
      c.x += laneVelocity(lane) * dt; // carried by the floe
      const center = c.centerX();
      if (center < 0 || center > STRAIT_W) {
        this.audio.splash();
        this.die(COLOR.splash); // swept off the edge
        return;
      }
    } else if (isIceRow(c.row)) {
      // A vehicle can only end up on the critter's tile by sliding INTO it (the
      // critter can never hop onto an occupied tile), so this is always a crush.
      if (this.vehicleAtTile(c.col(), c.row)) {
        this.audio.crush();
        this.die("#4a5560");
        return;
      }
    }
  }

  // Emerge, hop, catch, and reset the bears.
  private updateHunters(dt: number): void {
    const target: Tile = {
      col: clampCol(this.critter.col()),
      row: Math.max(2, Math.min(ROW_NEAR, this.critter.row)),
    };
    const advanced = ROW_NEAR - this.critter.row;

    for (const h of this.hunters) {
      if (!h.bear) {
        h.emergeDelay -= dt;
        if (h.emergeDelay <= 0 && advanced >= h.emergeAdvance) {
          const bear = new Bear(clampCol(this.critter.col()), ROW_NEAR);
          h.bear = bear;
          this.decideBearStep(bear, target);
        }
        continue;
      }
      const bear = h.bear;
      // Locomotion always runs; what the suspended pursuit stops is the DECIDING
      // below. A bear with nothing to travel toward has its target set to its own
      // tile and so does not move, which is what makes setBearAI(false) hold it in
      // place — but a step commanded through moveBear still glides for real. The
      // hazard, water, and catch handling below runs either way: suspending the
      // brain must not make the bear immune to the world
      // (specs/instrumentation.md).
      const arrived = bear.advance(dt);

      // Reset if a vehicle has swept into EITHER tile the bear occupies. Moving
      // continuously, it straddles the tile it is leaving and the one it is
      // entering, so a hit on either knocks it out (lure it into traffic).
      if (this.bearInTraffic(bear, dt)) {
        this.splashes.push({
          x: bear.centerX(),
          y: bear.centerY(),
          age: 0,
          color: "#4a5560",
        });
        h.bear = null;
        h.emergeDelay = BEAR_EMERGE_DELAY;
        continue;
      }

      if (arrived && this.bearAI) this.decideBearStep(bear, target);

      // Catch: within about half a tile of the critter.
      const cxc = this.critter.rx + TILE / 2;
      const cyc = this.critter.ry + TILE / 2;
      const dx = bear.centerX() - cxc;
      const dy = bear.centerY() - cyc;
      if (Math.hypot(dx, dy) < BEAR_CATCH_DIST) {
        bear.lunge = 0.4;
        this.audio.caught();
        this.die(COLOR.critter);
        return;
      }
    }
  }

  // Is a vehicle sitting on either tile the bear currently occupies? While gliding
  // between tiles it straddles both, so a hit on either resets it (specs/hunter.md).
  private bearInTraffic(bear: Bear, dt: number): boolean {
    return (
      (isIceRow(bear.row) && this.vehicleMovedOnto(bear.col, bear.row, dt)) ||
      (isIceRow(bear.targetRow) &&
        this.vehicleMovedOnto(bear.targetCol, bear.targetRow, dt))
    );
  }

  // At each tile center, pick the next grid step toward the critter (BFS around the
  // hazards) and commit the bear to gliding there at its footing-appropriate speed.
  private decideBearStep(bear: Bear, target: Tile): void {
    const next = chooseBearStep(this, { col: bear.col, row: bear.row }, target);
    const swimming = isWaterRow(next.row) && !this.hasFloe(next.col, next.row);
    const tilesPerSec =
      (swimming ? BEAR_SWIM_SPEED : BEAR_ICE_SPEED) *
      Math.pow(BEAR_SPEED_STEP, this.level - 1);
    bear.setTarget(next.col, next.row, tilesPerSec * TILE, swimming);
  }

  // Gentle idle motion for the title-screen bear (no pursuit, never catches).
  private animateTitleBear(): void {
    const bear = this.hunters[0]?.bear;
    if (!bear) return;
    const bob = Math.sin(this.simTime * 1.4) * 6;
    bear.rx = 6 * TILE + Math.sin(this.simTime * 0.4) * 40;
    bear.ry = 6 * TILE + bob;
    bear.swimming = true;
    bear.facing = "up";
  }

  // ---- Derived HUD helpers ----------------------------------------------

  filledBays(): number {
    return this.bays.filter(Boolean).length;
  }
  // Is the between-levels "LEVEL CLEAR" banner showing?
  clearActive(): boolean {
    return this.clearTimer > 0;
  }
  timerFrac(): number {
    return this.timerMax > 0 ? Math.max(0, this.timer / this.timerMax) : 0;
  }

  // ---- Debug driver surface (used by debug.ts; inert in normal play) --------
  //
  // Each control method routes through the same systems and transitions normal
  // play uses — it sets up a situation, never fabricates an outcome. `step`
  // (debug.ts) then runs the real hopping, drift, collision, pursuit, scoring,
  // and level logic forward from there. See specs/instrumentation.md.

  // Return to the title and reseed the randomness so a scenario replays
  // identically. An explicit seed persists for later resets.
  debugReset(seed?: number): void {
    if (seed !== undefined) this.seed = seed >>> 0;
    this.rng = mulberry32(this.seed);
    // The initial title state has no accumulated simulation time, so zero it too:
    // reseeding and replaying the same calls then reaches the same state exactly.
    this.simTime = 0;
    this.toTitle();
  }

  // Begin a fresh run exactly as choosing CROSS from the menu does.
  debugStartGame(): void {
    this.startGame();
  }

  // Jump to a level, rebuilding the strait (lane speeds/gaps, timer, and the
  // second bear from level 5) and starting a fresh crossing there.
  debugSetLevel(level: number): void {
    this.level = level;
    this.levelReached = level;
    this.startLevel();
    this.state = "playing";
  }

  debugSetLives(count: number): void {
    this.lives = count;
  }

  // Set the score, recomputing the next bonus-life milestone to the next 10,000
  // boundary above it, so a later real gain crosses it through the normal path.
  debugSetScore(points: number): void {
    this.score = points;
    this.nextBonusLife =
      (Math.floor(points / SCORE_BONUS_LIFE) + 1) * SCORE_BONUS_LIFE;
  }

  debugSetTimer(seconds: number): void {
    this.timer = seconds;
  }

  debugSetBays(filled: boolean[]): void {
    for (let i = 0; i < this.bays.length; i++) {
      this.bays[i] = Boolean(filled[i]);
    }
  }

  // Position the critter on a tile through the same placement respawns use; the
  // next step runs the real footing, drift, and collision on that tile.
  debugPlaceCritter(col: number, row: number): void {
    this.critter.place(col, row);
  }

  // Repopulate the lane at strait `row` with items of that row's fixed kind at
  // the tile columns in `spec.cols` (an empty array clears it), optionally
  // overriding the lane's speed/direction. The real step-driven motion and
  // collision still decide every outcome.
  debugSetLane(
    row: number,
    spec: { cols: number[]; speed?: number; dir?: 1 | -1 },
  ): void {
    const kind = laneKindForRow(row);
    if (!kind) return;
    const cols = spec.cols ?? [];
    const iceLane = this.lanes.ice.find((l) => l.row === row);
    if (iceLane) {
      const k = kind as VehicleKind;
      const len = laneItemLen(k);
      iceLane.items = cols.map((c) => ({ x: c * TILE, len, kind: k }));
      if (spec.speed !== undefined) iceLane.speed = spec.speed;
      if (spec.dir !== undefined) iceLane.dir = spec.dir;
      return;
    }
    const waterLane = this.lanes.water.find((l) => l.row === row);
    if (waterLane) {
      const k = kind as FloeKind;
      const len = laneItemLen(k);
      waterLane.items = cols.map((c) => ({ x: c * TILE, len, kind: k }));
      if (spec.speed !== undefined) waterLane.speed = spec.speed;
      if (spec.dir !== undefined) waterLane.dir = spec.dir;
    }
  }

  // Change how a lane is moving without disturbing what is in it: the items keep
  // their exact positions and travel on the new motion from the next step. A speed
  // of 0 holds the lane where it stands and a later call releases it. Unlike
  // debugSetLane this never repopulates the lane (specs/instrumentation.md).
  debugSetLaneMotion(row: number, spec: { speed?: number; dir?: 1 | -1 }): void {
    const lane =
      this.lanes.ice.find((l) => l.row === row) ??
      this.lanes.water.find((l) => l.row === row);
    if (!lane) return;
    if (spec.speed !== undefined) lane.speed = spec.speed;
    if (spec.dir !== undefined) lane.dir = spec.dir;
  }

  // Send a bear one tile in a grid direction under the caller's control rather
  // than the pursuit's (specs/instrumentation.md). It uses the same continuous
  // glide and the same speed the pursuit would have used, so what is driven is the
  // real movement rather than a teleport, and it deliberately does NOT consult the
  // route the pursuit would have chosen — a caller may send a bear somewhere the
  // pursuit would avoid, and what the world makes of that is the game's own
  // business. A bear between tiles settles onto the tile it is entering first.
  debugMoveBear(index: number, direction: string): void {
    const bear = this.hunters[index]?.bear;
    if (!bear) return;
    const delta: Record<string, [number, number]> = {
      up: [0, -1],
      down: [0, 1],
      left: [-1, 0],
      right: [1, 0],
    };
    const d = delta[direction];
    if (!d) return;
    const col = clampCol(bear.targetCol + d[0]);
    const row = Math.max(0, Math.min(ROW_NEAR, bear.targetRow + d[1]));
    const swimming = isWaterRow(row) && !this.hasFloe(col, row);
    const tilesPerSec =
      (swimming ? BEAR_SWIM_SPEED : BEAR_ICE_SPEED) *
      Math.pow(BEAR_SPEED_STEP, this.level - 1);
    bear.setTarget(col, row, tilesPerSec * TILE, swimming);
  }

  // Suspend or resume the pursuit brain for every hunter slot.
  debugSetBearAI(enabled: boolean): void {
    this.bearAI = enabled;
  }

  // Place or remove a hunter's bear. `state` of `{col,row}` puts that bear on a
  // tile (creating it if it has not emerged); `null` removes it (it re-emerges
  // from the near shore after the usual delay, as when knocked out). Once placed,
  // the real pursuit brain drives it from the next step.
  debugSetBear(
    index: number,
    state: { col?: number; row?: number; x?: number; y?: number } | null,
  ): void {
    while (this.hunters.length <= index) {
      this.hunters.push({ bear: null, emergeDelay: 0, emergeAdvance: 0 });
    }
    const h = this.hunters[index];
    if (state === null) {
      h.bear = null;
      h.emergeDelay = BEAR_EMERGE_DELAY;
      h.emergeAdvance = BEAR_EMERGE_ADVANCE;
      return;
    }
    // Either form is accepted: a tile, or an exact strait-local pixel position for
    // a bear part-way between tiles (specs/instrumentation.md). The pixel form
    // still names the tiles it occupies, so hazard collision reads the same either
    // way.
    const px = state.x !== undefined ? state.x : colToX(state.col ?? 0);
    const py = state.y !== undefined ? state.y : rowToY(state.row ?? 0);
    const col = state.col !== undefined ? state.col : Math.round(px / TILE);
    const row = state.row !== undefined ? state.row : Math.round(py / TILE);
    if (!h.bear) h.bear = new Bear(col, row);
    h.bear.col = col;
    h.bear.row = row;
    h.bear.targetCol = col;
    h.bear.targetRow = row;
    h.bear.rx = px;
    h.bear.ry = py;
    h.bear.speed = 0;
    h.emergeDelay = 0;
    h.emergeAdvance = 0;
  }

  // A pure read of the full observable state, shared by the debug API's
  // snapshot() and the debug overlay. Never changes anything.
  debugSnapshot(): FloeSnapshot {
    const c = this.critter;
    let footing: "solid" | "floe" | "water" = "solid";
    if (isWaterRow(c.row)) {
      const lane = this.waterLaneForRow(c.row);
      footing = lane && this.floeUnder(lane, c.centerX()) ? "floe" : "water";
    }
    return {
      version: 1,
      screen: this.state,
      phase: this.phase,
      level: this.level,
      lives: this.lives,
      score: this.score,
      timer: this.timer,
      timerMax: this.timerMax,
      muted: this.audio.isMuted(),
      menuIndex: this.menuIndex,
      bays: [...this.bays],
      fishBay: this.fishBay,
      critter: {
        col: c.col(),
        row: c.row,
        x: c.x,
        y: rowToY(c.row),
        facing: c.facing,
        footing,
      },
      bears: this.hunters.map((h) => {
        const b = h.bear;
        if (!b) {
          return {
            present: false,
            col: 0,
            row: 0,
            x: 0,
            y: 0,
            facing: "up" as Dir,
            swimming: false,
          };
        }
        return {
          present: true,
          col: b.col,
          row: b.row,
          x: b.rx,
          y: b.ry,
          facing: b.facing,
          swimming: b.swimming,
        };
      }),
      lanes: {
        ice: this.lanes.ice.map((l) => ({
          row: l.row,
          dir: l.dir,
          speed: l.speed,
          items: l.items.map((v) => ({ kind: v.kind, x: v.x, len: v.len })),
        })),
        water: this.lanes.water.map((l) => ({
          row: l.row,
          dir: l.dir,
          speed: l.speed,
          items: l.items.map((f) => ({ kind: f.kind, x: f.x, len: f.len })),
        })),
      },
      simTime: this.simTime,
    };
  }
}

// ---- The JSON-serializable state the debug API and overlay report -----------

export interface CritterSnapshot {
  col: number;
  row: number;
  x: number;
  y: number;
  facing: Dir;
  footing: "solid" | "floe" | "water";
}

export interface BearSnapshot {
  present: boolean;
  col: number;
  row: number;
  x: number;
  y: number;
  facing: Dir;
  swimming: boolean;
}

export interface LaneItemSnapshot {
  kind: VehicleKind | FloeKind;
  x: number;
  len: number;
}

export interface LaneSnapshot {
  row: number;
  dir: 1 | -1;
  speed: number;
  items: LaneItemSnapshot[];
}

export interface FloeSnapshot {
  version: number;
  screen: AppState;
  phase: Phase;
  level: number;
  lives: number;
  score: number;
  timer: number;
  timerMax: number;
  muted: boolean;
  menuIndex: number;
  bays: boolean[];
  fishBay: number | null;
  critter: CritterSnapshot;
  bears: BearSnapshot[];
  lanes: { ice: LaneSnapshot[]; water: LaneSnapshot[] };
  simTime: number;
}
