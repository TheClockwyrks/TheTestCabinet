// Fathom — the game: state machine, match flow, and the per-step simulation
// (specs/flow.md). Owns the forager, predators, drifter, ink, plankton, fog,
// scoring, lives, and depth. Rendering lives in render.ts.

import type { Assets } from "./assets";
import { Audio } from "./audio";
import {
  BRIGHT_HALFLIFE,
  BRIGHT_HOLD,
  BRIGHT_PER_EAT,
  COLOR,
  COLS,
  DETECT_FLASH_TIME,
  DIVE_COUNT,
  DIVE_STEP,
  DRIFTER_INTERVAL,
  DRIFTER_LIFE,
  DRIFTER_SPEED,
  FLARE_INTERVAL,
  FORAGER_SPEED,
  GATE_COL,
  GATE_ROW,
  GLOAMFIN_PING_INTERVAL,
  INK_COOLDOWN,
  INK_LIFE,
  INK_RADIUS,
  predatorSpeedMult,
  RELEASE_FLAREFISH,
  RELEASE_GLOAMFIN,
  RELEASE_LANTERNJAW,
  ROWS,
  SCORE_CLEAR,
  SCORE_DRIFTER,
  SCORE_PLANKTON,
  SONAR_COOLDOWN,
  SONAR_MARK_TIME,
  sonarRange,
  START_COL,
  START_LIVES,
  START_ROW,
  TILE,
  VISION_GAIN,
  VISION_MIN,
} from "./constants";
import { advance, Drifter, Forager, Predator } from "./entities";
import { Effects } from "./effects";
import { Input } from "./input";
import { Maze } from "./maze";
import { Fog, tileKey } from "./sensing";
import { updatePredator, World } from "./predators";
import { Dir, GameState, PredKind, PredState } from "./types";

export interface Ink {
  x: number;
  y: number;
  life: number;
}

const TITLE_ITEMS = ["DIVE", "HOW TO PLAY"];
const PAUSE_ITEMS = ["RESUME", "RESTART", "QUIT TO MENU"];
const OVER_ITEMS = ["PLAY AGAIN", "MENU"];

export class Game {
  readonly maze = new Maze();
  readonly fog = new Fog();
  readonly effects = new Effects();
  readonly audio = new Audio();
  readonly assets: Assets;
  private input: Input;

  state: GameState = GameState.Title;
  menu = 0;
  time = 0; // wall-clock-ish accumulator for animations/blink

  score = 0;
  lives = START_LIVES;
  depth = 1;

  forager = new Forager(START_COL, START_ROW, FORAGER_SPEED);
  predators: Predator[] = [];
  drifter: Drifter | null = null;
  clouds: Ink[] = [];

  // plankton[key] = present
  plankton: boolean[] = new Array(COLS * ROWS).fill(false);
  planktonLeft = 0;

  sonarCd = 0;
  inkCd = 0;
  brightHold = 0; // s brightness G holds before it starts to decay (specs/sensing.md)
  driftT = DRIFTER_INTERVAL;
  diveT = 0; // dive countdown remaining
  clearedT = 0; // trench-cleared interstitial remaining

  constructor(input: Input, assets: Assets) {
    this.input = input;
    this.assets = assets;
    this.buildPredators();
  }

  private buildPredators(): void {
    this.predators = [
      new Predator(PredKind.Lanternjaw, 17, 8, RELEASE_LANTERNJAW),
      new Predator(PredKind.Gloamfin, 18, 8, RELEASE_GLOAMFIN),
      new Predator(PredKind.Flarefish, 16, 8, RELEASE_FLAREFISH),
    ];
  }

  // ---- ink helpers ------------------------------------------------------
  inkAt = (x: number, y: number): boolean =>
    this.clouds.some((c) => Math.hypot(x - c.x, y - c.y) <= INK_RADIUS);

  inkBetween = (x1: number, y1: number, x2: number, y2: number): boolean =>
    this.clouds.some((c) => segDist(c.x, c.y, x1, y1, x2, y2) <= INK_RADIUS);

  get visionRadius(): number {
    return VISION_MIN + VISION_GAIN * this.forager.g;
  }

  // ---- match flow -------------------------------------------------------
  private newGame(): void {
    this.score = 0;
    this.lives = START_LIVES;
    this.depth = 1;
    this.buildTrench(true);
    this.startDive();
  }

  // Reset everything for a fresh trench. `fresh` wipes fog + refills plankton
  // (new game or descending a depth); otherwise memory and eaten plankton
  // persist (losing a life).
  private buildTrench(fresh: boolean): void {
    if (fresh) {
      this.fog.reset();
      this.plankton.fill(false);
      this.planktonLeft = 0;
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          if (
            this.maze.foragerOpen(c, r) &&
            !this.maze.isWrapEdge(c, r)
          ) {
            this.plankton[tileKey(c, r)] = true;
            this.planktonLeft++;
          }
        }
      }
    }
    this.resetPositions();
  }

  private resetPositions(): void {
    this.forager = new Forager(START_COL, START_ROW, FORAGER_SPEED);
    this.buildPredators();
    for (const p of this.predators) {
      p.state = PredState.Den;
      p.denTimer = p.releaseAt;
      p.hasFix = false;
      p.linger = 0;
      p.blindT = 0;
      p.markT = 0;
      p.alertT = 0;
      p.pulseT = GLOAMFIN_PING_INTERVAL;
      p.searching = false;
      p.searchT = 0;
      p.searchPingT = 0;
      p.flareT = FLARE_INTERVAL;
      p.flaring = false;
    }
    this.drifter = null;
    this.clouds = [];
    this.effects.clear();
    this.sonarCd = 0;
    this.inkCd = 0;
    this.brightHold = 0;
    this.driftT = DRIFTER_INTERVAL;
  }

  private startDive(): void {
    this.state = GameState.Dive;
    this.diveT = DIVE_COUNT * DIVE_STEP;
  }

  private loseLife(): void {
    this.audio.play("caught");
    this.lives--;
    if (this.lives < 0) {
      this.state = GameState.GameOver;
      this.menu = 0;
      return;
    }
    this.buildTrench(false); // keep fog + plankton
    this.startDive();
  }

  private clearTrench(): void {
    this.score += SCORE_CLEAR;
    this.audio.play("descend");
    this.state = GameState.Cleared;
    this.clearedT = 1.6;
  }

  private descend(): void {
    this.depth++;
    this.buildTrench(true);
    this.startDive();
  }

  // ---- input (edge events), once per rendered frame --------------------
  handleInput(): void {
    for (const a of this.input.drain()) {
      if (a === "mute") {
        this.audio.toggleMute();
        continue;
      }
      switch (this.state) {
        case GameState.Title:
          this.menuNav(a, TITLE_ITEMS.length, () => {
            if (this.menu === 0) this.newGame();
            else this.state = GameState.HowTo;
          });
          break;
        case GameState.HowTo:
          if (a === "confirm" || a === "back") {
            this.state = GameState.Title;
            this.menu = 0;
          }
          break;
        case GameState.Playing:
          if (a === "pause") {
            this.state = GameState.Paused;
            this.menu = 0;
          } else if (a === "sonar") this.fireSonar();
          else if (a === "ink") this.dropInk();
          break;
        case GameState.Paused:
          this.menuNav(a, PAUSE_ITEMS.length, () => {
            if (this.menu === 0) this.state = GameState.Playing;
            else if (this.menu === 1) this.newGame();
            else {
              this.state = GameState.Title;
              this.menu = 0;
            }
          });
          if (a === "pause") this.state = GameState.Playing;
          break;
        case GameState.GameOver:
          this.menuNav(a, OVER_ITEMS.length, () => {
            if (this.menu === 0) this.newGame();
            else {
              this.state = GameState.Title;
              this.menu = 0;
            }
          });
          break;
        case GameState.Dive:
        case GameState.Cleared:
          break;
      }
    }
  }

  private menuNav(a: string, count: number, confirm: () => void): void {
    if (a === "up") this.menu = (this.menu + count - 1) % count;
    else if (a === "down") this.menu = (this.menu + 1) % count;
    else if (a === "confirm") {
      this.audio.resume();
      confirm();
    }
  }

  // ---- abilities --------------------------------------------------------
  private fireSonar(): void {
    if (this.sonarCd > 0) return;
    this.sonarCd = SONAR_COOLDOWN;
    this.audio.resume();
    this.audio.play("sonar");
    const E = sonarRange(this.depth);
    const flooded = this.maze.flood(this.forager.col, this.forager.row, E);
    const set = new Set<number>();
    for (const cell of flooded) {
      this.fog.reveal(cell.col, cell.row);
      set.add(tileKey(cell.col, cell.row));
      // Reveal the wall tiles bounding this corridor too (specs/sensing.md).
      for (const [dc, dr] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
        if (this.maze.isWall(cell.col + dc, cell.row + dr))
          this.fog.reveal(cell.col + dc, cell.row + dr);
      }
    }
    // Mark predators / drifter caught in the flood for their reveal window.
    for (const p of this.predators) {
      if (p.state !== PredState.Den && set.has(tileKey(p.col, p.row)))
        p.markT = Math.max(p.markT, SONAR_MARK_TIME);
    }
    if (this.drifter && set.has(tileKey(this.drifter.col, this.drifter.row)))
      this.drifter.markT = Math.max(this.drifter.markT, SONAR_MARK_TIME);
    // The Gloamfin hears the pulse: if the flood reaches it, it takes a fix on
    // you and gives chase — and the detection alert fires (specs/predators.md).
    for (const p of this.predators) {
      if (p.kind === PredKind.Gloamfin && p.state !== PredState.Den &&
          set.has(tileKey(p.col, p.row))) {
        this.alertAcquire(p, this.forager.col, this.forager.row);
      }
    }
    this.effects.addRing(this.forager.x, this.forager.y, E * TILE, false);
  }

  // The forager's pulse hands the Gloamfin a fix: chase, and fire the detection
  // alert on a fresh acquisition (mirrors `acquire` in predators.ts).
  private alertAcquire(p: Predator, col: number, row: number): void {
    const alreadyChasing = p.hasFix && !p.searching && p.state === PredState.Hunt;
    p.hasFix = true;
    p.fixCol = col;
    p.fixRow = row;
    p.searching = false;
    p.state = PredState.Hunt;
    if (!alreadyChasing) {
      p.alertT = DETECT_FLASH_TIME;
      this.effects.addBurst(p.x, p.y, COLOR.gloamfin);
      this.audio.play("alert");
    }
  }

  private dropInk(): void {
    if (this.inkCd > 0) return;
    this.inkCd = INK_COOLDOWN;
    this.audio.resume();
    this.audio.play("ink");
    this.clouds.push({ x: this.forager.x, y: this.forager.y, life: INK_LIFE });
  }

  // ---- fixed-step simulation -------------------------------------------
  fixedStep(dt: number): void {
    this.time += dt;
    switch (this.state) {
      case GameState.Dive:
        this.diveT -= dt;
        // keep fog lit around the forager while the countdown holds
        this.fog.computePassiveLit(this.maze, this.forager.x, this.forager.y, this.visionRadius);
        if (this.diveT <= 0) this.state = GameState.Playing;
        break;
      case GameState.Cleared:
        this.clearedT -= dt;
        if (this.clearedT <= 0) this.descend();
        break;
      case GameState.Playing:
        this.stepPlay(dt);
        break;
      default:
        break;
    }
  }

  private stepPlay(dt: number): void {
    // Cooldowns / brightness. G holds for BRIGHT_HOLD after the last pellet
    // (the timer resets on each eat) and only then decays — never a constant
    // drain (specs/sensing.md).
    this.sonarCd = Math.max(0, this.sonarCd - dt);
    this.inkCd = Math.max(0, this.inkCd - dt);
    if (this.brightHold > 0) {
      this.brightHold = Math.max(0, this.brightHold - dt);
    } else {
      this.forager.g *= Math.pow(0.5, dt / BRIGHT_HALFLIFE);
      if (this.forager.g < 0.001) this.forager.g = 0;
    }

    // Forager movement.
    advance(
      this.forager,
      dt,
      this.maze,
      () => this.input.desiredDir(),
      (c, r) => this.maze.foragerOpen(c, r),
      () => true,
    );

    // Eat plankton on the forager's current tile.
    const fk = tileKey(this.forager.col, this.forager.row);
    if (this.plankton[fk]) {
      this.plankton[fk] = false;
      this.planktonLeft--;
      this.score += SCORE_PLANKTON;
      this.forager.g = Math.min(1, this.forager.g + BRIGHT_PER_EAT);
      this.brightHold = BRIGHT_HOLD; // hold the glow before it starts to decay
      this.audio.play("eat");
    }

    // Ink clouds.
    for (const c of this.clouds) c.life -= dt;
    this.clouds = this.clouds.filter((c) => c.life > 0);
    // Blind the two sight predators while ink covers them or the line to us.
    // The Gloamfin hunts by sound, so ink does nothing to it (specs/movement.md).
    for (const p of this.predators) {
      if (p.kind === PredKind.Gloamfin || p.state === PredState.Den) continue;
      if (
        this.inkAt(p.x, p.y) ||
        this.inkBetween(p.x, p.y, this.forager.x, this.forager.y)
      ) {
        p.blindT = Math.max(p.blindT, 0.12);
      }
    }

    // Predators.
    const world: World = {
      maze: this.maze,
      fog: this.fog,
      effects: this.effects,
      audio: this.audio,
      forager: this.forager,
      fcol: this.forager.col,
      frow: this.forager.row,
      depthMult: predatorSpeedMult(this.depth),
      predators: this.predators,
      drifter: this.drifter,
      rand: Math.random,
      inkAt: this.inkAt,
      inkBetween: this.inkBetween,
    };
    for (const p of this.predators) updatePredator(p, dt, world);

    // Bonus drifter.
    this.updateDrifter(dt);

    // Effects (rings/bursts) + fog. The Lanternjaw's always-visible bulb and the
    // always-visible drifter are drawn by render.ts, not marked here.
    this.effects.update(dt);
    this.fog.computePassiveLit(this.maze, this.forager.x, this.forager.y, this.visionRadius);

    // Collisions: contact with any out-of-den predator costs a life.
    for (const p of this.predators) {
      if (p.state === PredState.Den) continue;
      if (Math.hypot(p.x - this.forager.x, p.y - this.forager.y) < 15) {
        this.loseLife();
        return;
      }
    }

    // Trench cleared?
    if (this.planktonLeft <= 0) this.clearTrench();
  }

  private updateDrifter(dt: number): void {
    if (this.drifter) {
      this.drifter.markT = Math.max(0, this.drifter.markT - dt);
      this.drifter.life -= dt;
      advance(
        this.drifter,
        dt,
        this.maze,
        () => patrolWander(this.drifter!, this.maze),
        (c, r) => this.maze.foragerOpen(c, r) && !this.maze.isWrapEdge(c, r),
        () => true,
      );
      // Eat the drifter.
      if (
        this.drifter.col === this.forager.col &&
        this.drifter.row === this.forager.row
      ) {
        this.score += SCORE_DRIFTER;
        this.audio.play("eat");
        this.drifter = null;
        return;
      }
      if (this.drifter.life <= 0) this.drifter = null;
      return;
    }
    // Spawn cadence (only while plankton remain).
    this.driftT -= dt;
    if (this.driftT <= 0 && this.planktonLeft > 0) {
      this.driftT = DRIFTER_INTERVAL;
      this.drifter = new Drifter(GATE_COL, GATE_ROW - 1, DRIFTER_SPEED, DRIFTER_LIFE);
    }
  }

  // View-model getters used by render.ts -------------------------------
  titleItems = TITLE_ITEMS;
  pauseItems = PAUSE_ITEMS;
  overItems = OVER_ITEMS;

  // Whether a mover (predator/drifter) is currently visible: lit by passive
  // light, inside its sonar/flare reveal window, or in an active flare bloom.
  entityVisible(col: number, row: number, markT: number): boolean {
    if (markT > 0) return true;
    if (this.fog.isLit(col, row)) return true;
    return false;
  }

  diveNumber(): number {
    return Math.max(1, Math.ceil(this.diveT / DIVE_STEP));
  }
}

// ---- small helpers -----------------------------------------------------

function segDist(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((px - x1) * dx + (py - y1) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = x1 + t * dx;
  const cy = y1 + t * dy;
  return Math.hypot(px - cx, py - cy);
}

const WANDER_DIRS = [Dir.Up, Dir.Down, Dir.Left, Dir.Right];
function patrolWander(m: Drifter, maze: Maze): Dir {
  const opts: Dir[] = [];
  for (const d of WANDER_DIRS) {
    const n = maze.step(m.col, m.row, d);
    if (maze.foragerOpen(n.col, n.row) && !maze.isWrapEdge(n.col, n.row))
      opts.push(d);
  }
  const opp = m.dir;
  const noRev = opts.filter((d) => !isOpposite(d, opp));
  const pool = noRev.length ? noRev : opts;
  if (!pool.length) return Dir.None;
  if (pool.includes(m.dir) && Math.random() < 0.6) return m.dir;
  return pool[Math.floor(Math.random() * pool.length)];
}
function isOpposite(a: Dir, b: Dir): boolean {
  return (
    (a === Dir.Up && b === Dir.Down) ||
    (a === Dir.Down && b === Dir.Up) ||
    (a === Dir.Left && b === Dir.Right) ||
    (a === Dir.Right && b === Dir.Left)
  );
}
