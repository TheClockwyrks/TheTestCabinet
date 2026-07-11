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
  DRIFTER_SPEED,
  FLARE_INTERVAL,
  FORAGER_SPEED,
  GATE_COL,
  GATE_ROW,
  GLOAMFIN_CHASE_SPEED,
  GLOAMFIN_PING_INTERVAL,
  KINDLE_VISION_GAIN,
  KINDLE_VISION_MIN,
  INK_COOLDOWN,
  INK_LIFE,
  INK_RADIUS,
  MAX_DRIFTERS,
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
  VISION_GAIN,
  VISION_MIN,
} from "./constants";
import { advance, Drifter, Forager, Predator, wanderDir } from "./entities";
import { Effects } from "./effects";
import { Input } from "./input";
import { Maze } from "./maze";
import { Fog, tileKey } from "./sensing";
import { updatePredator, World } from "./predators";
import { SonarWave } from "./sonar";
import { GameState, PredKind, PredState } from "./types";

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
  drifters: Drifter[] = [];
  clouds: Ink[] = [];
  // Sonar pulses currently travelling out through the trench (forager + Gloamfin).
  waves: SonarWave[] = [];

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

  // The per-tile light circle (reveals + shows predators), same as Base.
  get visionRadius(): number {
    return VISION_MIN + VISION_GAIN * this.forager.g;
  }

  // Kindle only — the outer vision circle (render mask), grows as you eat.
  get visionCircle(): number {
    return KINDLE_VISION_MIN + KINDLE_VISION_GAIN * this.forager.g;
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
      p.pingLock = 0;
      p.searching = false;
      p.searchT = 0;
      p.searchPingT = 0;
      p.chaseSpeed = GLOAMFIN_CHASE_SPEED;
      p.flareT = FLARE_INTERVAL;
      p.flaring = false;
    }
    this.drifters = [];
    this.clouds = [];
    this.waves.length = 0;
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
    // Cast the pulse. It reveals terrain and marks/senses movers as its front
    // sweeps over them (see stepWaves) rather than all at once — near tiles
    // first, far tiles later, following the corridors it travels down.
    const E = sonarRange(this.depth);
    this.spawnWave(this.forager.x, this.forager.y, this.forager.col, this.forager.row, E, false, null);
  }

  // Emit a sonar pulse from a source tile. The forager's ping (violet=false)
  // reveals the trench as it travels; the Gloamfin's ping (violet=true) reveals
  // nothing — it only carries the sound out to sense the forager (specs/sensing.md).
  spawnWave = (
    ox: number,
    oy: number,
    col: number,
    row: number,
    range: number,
    violet: boolean,
    emitter: Predator | null,
    lostYou = false,
  ): void => {
    const buckets = this.maze.floodBuckets(col, row, range);
    const wave = new SonarWave(ox, oy, buckets, violet, !violet);
    wave.emitter = emitter;
    // The guaranteed "lost you" ping renders orange (distinct from the ordinary
    // violet ping) so the escape window is legible (specs/predators.md).
    wave.orange = lostYou;
    this.waves.push(wave);
  };

  // Advance every live sonar pulse one step: reveal the terrain its front just
  // reached (forager's ping only), and sense any mover the front just swept over.
  private stepWaves(dt: number): void {
    for (const wave of this.waves) {
      const crossed = wave.advance(dt);
      if (wave.reveal) {
        for (const bucket of crossed) {
          for (const cell of bucket) {
            this.fog.reveal(cell.col, cell.row);
            // Reveal the wall tiles bounding this corridor too (specs/sensing.md).
            for (const [dc, dr] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
              if (this.maze.isWall(cell.col + dc, cell.row + dr))
                this.fog.reveal(cell.col + dc, cell.row + dr);
            }
          }
        }
      }
      this.senseWithWave(wave);
    }
    this.waves = this.waves.filter((w) => !w.done);
  }

  // Apply a wave's sensing once its front reaches an entity. The forager's ping
  // marks predators/drifters for their reveal window and hands the Gloamfin a fix
  // if it reaches it; the Gloamfin's own ping catches the forager when its front
  // arrives — a brief, watchable delay instead of an instant snap.
  private senseWithWave(wave: SonarWave): void {
    if (wave.reveal) {
      for (const p of this.predators) {
        if (p.state === PredState.Den || wave.hitPreds.has(p)) continue;
        if (!wave.reached(p.col, p.row)) continue;
        wave.hitPreds.add(p);
        p.markT = Math.max(p.markT, SONAR_MARK_TIME);
        // The Gloamfin hears the pulse and takes a fix on you (specs/predators.md).
        if (p.kind === PredKind.Gloamfin)
          this.alertAcquire(p, this.forager.col, this.forager.row);
      }
      for (const d of this.drifters) {
        if (wave.hitDrifters.has(d)) continue;
        if (!wave.reached(d.col, d.row)) continue;
        wave.hitDrifters.add(d);
        d.markT = Math.max(d.markT, SONAR_MARK_TIME);
      }
    } else if (
      !wave.playerHit &&
      wave.emitter &&
      wave.emitter.state !== PredState.Den &&
      wave.reached(this.forager.col, this.forager.row)
    ) {
      wave.playerHit = true;
      this.alertAcquire(wave.emitter, this.forager.col, this.forager.row);
    }
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
      p.chaseSpeed = GLOAMFIN_CHASE_SPEED; // fresh chase opens at the +5% cap
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
      drifters: this.drifters,
      rand: Math.random,
      inkAt: this.inkAt,
      inkBetween: this.inkBetween,
      spawnWave: this.spawnWave,
    };
    for (const p of this.predators) updatePredator(p, dt, world);

    // Bonus drifters.
    this.updateDrifters(dt);

    // Advance every travelling sonar pulse: reveal the tiles its front reaches
    // this step and sense any mover it sweeps over (a ping cast this tick by the
    // forager or the Gloamfin starts travelling out on the next).
    this.stepWaves(dt);

    // Effects (bursts) + fog. The Lanternjaw's always-visible bulb and the
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

  private updateDrifters(dt: number): void {
    // Existing drifters wander until eaten — a drifter is permanent, no fade-out
    // (specs/playfield.md), so an amber glimmer you spot stays out there.
    for (const d of this.drifters) {
      d.markT = Math.max(0, d.markT - dt);
      advance(
        d,
        dt,
        this.maze,
        () => wanderDir(d, this.maze, Math.random),
        (c, r) => this.maze.foragerOpen(c, r) && !this.maze.isWrapEdge(c, r),
        () => true,
      );
    }
    // Eat any drifter the forager is on (score each).
    const before = this.drifters.length;
    this.drifters = this.drifters.filter(
      (d) => !(d.col === this.forager.col && d.row === this.forager.row),
    );
    const eaten = before - this.drifters.length;
    if (eaten > 0) {
      this.score += SCORE_DRIFTER * eaten;
      this.audio.play("eat");
    }
    // Spawn cadence: up to MAX_DRIFTERS at once, one every DRIFTER_INTERVAL, only
    // while plankton remain. The timer only advances while there is room, so a
    // freed slot refills after a fresh interval rather than instantly.
    if (this.drifters.length < MAX_DRIFTERS) {
      this.driftT -= dt;
      if (this.driftT <= 0 && this.planktonLeft > 0) {
        this.driftT = DRIFTER_INTERVAL;
        this.drifters.push(new Drifter(GATE_COL, GATE_ROW - 1, DRIFTER_SPEED));
      }
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
