// Floe — the game: the state machine, the crossing flow, and the fixed-step
// simulation (specs/flow.md). Rendering lives in render.ts and reads this object's
// public fields. main.ts drives it: once-per-frame edge input via handleInput(),
// then fixed-timestep physics via fixedStep().

import { Audio } from "./audio";
import {
  BAY_COUNT,
  BAYFILL_PAUSE,
  BEAR_CATCH_DIST,
  BEAR_EMERGE_ADVANCE,
  BEAR_EMERGE_DELAY,
  BEAR_ICE_HOP,
  BEAR_SECOND_DELAY,
  BEAR_SPEED_STEP,
  BEAR_SWIM_HOP,
  CLEAR_PAUSE,
  COLOR,
  DEATH_PAUSE,
  HOP_COOLDOWN,
  ROW_NEAR,
  SCORE_BAY,
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
  isIceRow,
  isWaterRow,
  xToCol,
} from "./grid";
import { chooseBearStep, type Tile, type WorldView } from "./hunter";
import {
  buildLevelLanes,
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
import type { AppState, Dir, Floe, Lane, Phase, Vehicle } from "./types";
import { DIR_VEC } from "./types";

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

  constructor(input: Input) {
    this.input = input;
    this.input.onFirstPress(() => this.audio.resume());
    this.toTitle();
  }

  // ---- WorldView (for the hunter's pathfinding) -------------------------

  // Exact coverage — used to actually knock the bear out when caught in traffic.
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
    // Atmosphere: a resting critter on the near shore, a swimming bear behind it.
    this.critter.place(20, ROW_NEAR);
    this.hunters = [{ bear: new Bear(7, 6), emergeDelay: 0, emergeAdvance: 0 }];
    this.hunters[0].bear!.swimming = true;
    this.splashes = [];
  }

  private startGame(): void {
    this.lives = START_LIVES;
    this.score = 0;
    this.level = 1;
    this.levelReached = 1;
    this.startLevel();
    this.state = "playing";
  }

  private startLevel(): void {
    this.levelReached = this.level;
    this.lanes = buildLevelLanes(this.level);
    this.bays.fill(false);
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
    this.score += SCORE_BAY + timeBonus;
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
    this.score += SCORE_LEVEL * this.level;
    if (this.level >= TOTAL_LEVELS) {
      this.score += SCORE_VICTORY_LIFE * this.lives;
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
      this.animateTitleBear(dt);
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
    // During the death pause the lanes keep sliding for readability, but nothing
    // can collide (the critter is gone).
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
      // Horizontal: one absolute tile; refuse if it would leave the strait.
      const nx = c.x + dc * TILE;
      const center = nx + TILE / 2;
      if (center < 0 || center > STRAIT_W) return false;
      c.x = nx;
      c.startHop(dir);
      this.audio.hop();
      return true;
    }

    const nr = c.row + dr;
    if (dir === "down") {
      if (nr > ROW_NEAR) return false; // below the near shore
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
    c.row = nr;
    c.startHop(dir);
    this.audio.hop();
    this.scoreRowAdvance(nr);
    return true;
  }

  private scoreRowAdvance(newRow: number): void {
    if (newRow < this.bestRow) {
      this.score += (this.bestRow - newRow) * SCORE_ROW;
      this.bestRow = newRow;
    }
  }

  // Water carry, drowning, and off-edge death; ice-band crushing.
  private updateCritterFooting(dt: number): void {
    const c = this.critter;
    if (isWaterRow(c.row)) {
      const lane = this.waterLaneForRow(c.row)!;
      const floe = this.floeUnder(lane, c.centerX());
      if (!floe) {
        this.die(COLOR.splash);
        return;
      }
      c.x += laneVelocity(lane) * dt; // carried by the floe
      const center = c.centerX();
      if (center < 0 || center > STRAIT_W) {
        this.die(COLOR.splash); // swept off the edge
        return;
      }
    } else if (isIceRow(c.row)) {
      const lane = this.iceLaneForRow(c.row)!;
      const left = c.x + 5;
      const right = c.x + TILE - 5;
      for (const v of lane.items) {
        if (v.x < right && v.x + v.len * TILE > left) {
          this.die("#4a5560");
          return;
        }
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
          this.decideBearHop(bear, target);
        }
        continue;
      }
      const bear = h.bear;
      const done = bear.advance(dt);

      // Reset if a vehicle has swept into the bear's tile (lure it into traffic).
      if (isIceRow(bear.row) && this.vehicleCovers(bear.col, bear.row)) {
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

      if (done) this.decideBearHop(bear, target);

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

  private decideBearHop(bear: Bear, target: Tile): void {
    const next = chooseBearStep(this, { col: bear.col, row: bear.row }, target);
    const swimming = isWaterRow(next.row) && !this.hasFloe(next.col, next.row);
    const base = swimming ? BEAR_SWIM_HOP : BEAR_ICE_HOP;
    const dur = base * Math.pow(BEAR_SPEED_STEP, this.level - 1);
    bear.hopTo(next.col, next.row, dur, swimming);
  }

  // Gentle idle motion for the title-screen bear (no pursuit, never catches).
  private animateTitleBear(dt: number): void {
    const bear = this.hunters[0]?.bear;
    if (!bear) return;
    bear.hopElapsed += dt;
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
}
