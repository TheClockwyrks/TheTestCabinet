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
  FLARE_BLOOM,
  FLARE_CHARGE,
  FLARE_FADE,
  FLARE_INTERVAL,
  FLARE_RADIUS,
  FORAGER_SPEED,
  GATE_COL,
  GATE_ROW,
  GLOAMFIN_CHASE_SPEED,
  GLOAMFIN_HEAR_RANGE,
  GLOAMFIN_PING_INTERVAL,
  GRID_X,
  GRID_Y,
  INK_COOLDOWN,
  INK_LIFE,
  INK_RADIUS,
  KINDLE_VISION_GAIN,
  KINDLE_VISION_MIN,
  LANTERNJAW_RANGE_BASE,
  LANTERNJAW_RANGE_GAIN,
  MAX_DRIFTERS,
  RELEASE_STAGGER,
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
import { advance, Drifter, Forager, Predator, wanderDir } from "./entities";
import { Effects } from "./effects";
import { Input } from "./input";
import { Maze } from "./maze";
import { makeRng } from "./rng";
import { Fog, tileKey } from "./sensing";
import { updatePredator, World } from "./predators";
import { SonarWave } from "./sonar";
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
  drifters: Drifter[] = [];
  clouds: Ink[] = [];
  // Sonar pulses currently traveling out through the trench (forager + Gloamfin).
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

  // Seedable randomness: every random draw the game makes (predator/drifter
  // wander, drifter spawn cadence) runs off this generator, so reseeding and
  // replaying the same calls reproduces the same result exactly
  // (specs/instrumentation.md). Ordinary play seeds it once at startup.
  private seed = 0x9e3779b9;
  private rng: () => number = makeRng(this.seed);

  // The manual clock (specs/instrumentation.md). On by default for normal human
  // play: the animation-frame loop advances the simulation each frame. The debug
  // API turns it off (reset/step) to take exact, load-independent measurements by
  // driving the clock itself, and back on (setAutoStep(true)) to record live clips.
  autoStep = true;

  // The read-only debug overlay, toggled with the backtick key. Off by default;
  // never affects gameplay (specs/instrumentation.md).
  debugOverlay = false;

  constructor(input: Input, assets: Assets) {
    this.input = input;
    this.assets = assets;
    this.buildPredators();
  }

  // Reseed all of the game's randomness (specs/instrumentation.md).
  private reseed(seed: number): void {
    this.seed = seed >>> 0;
    this.rng = makeRng(this.seed);
  }

  // The predator roster for the current depth (specs/predators.md): one of each at
  // DEPTH 1, then one more predator per depth cycling Gloamfin, Lanternjaw, Flarefish,
  // capped at two of each (six total) from DEPTH 4 on.
  private predatorRoster(): PredKind[] {
    const roster = [PredKind.Lanternjaw, PredKind.Gloamfin, PredKind.Flarefish];
    const added = [PredKind.Gloamfin, PredKind.Lanternjaw, PredKind.Flarefish];
    const extra = Math.min(Math.max(this.depth - 1, 0), added.length);
    for (let i = 0; i < extra; i++) roster.push(added[i]);
    return roster;
  }

  private buildPredators(): void {
    // Den spawn tiles inside the den bounds (specs/maze.md), reused in order; each
    // predator leaves RELEASE_STAGGER seconds after the one before it.
    const denTiles: [number, number][] = [
      [17, 8],
      [18, 8],
      [16, 8],
      [19, 8],
      [17, 7],
      [18, 7],
    ];
    this.predators = this.predatorRoster().map((kind, i) => {
      const [tx, ty] = denTiles[i % denTiles.length];
      return new Predator(kind, tx, ty, i * RELEASE_STAGGER);
    });
  }

  // Put every predator back in the den, its timer armed to its staggered release.
  private denPredators(): void {
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
    this.denPredators();
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
      if (a === "debug") {
        this.debugOverlay = !this.debugOverlay;
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
        // A pulse marks the Gloamfin and Flarefish, but NOT the Lanternjaw: like the
        // bonus drifter it is an amber-light entity whose always-visible bulb is its
        // only tell, so sonar never reveals its body (specs/sensing.md).
        if (p.kind !== PredKind.Lanternjaw)
          p.markT = Math.max(p.markT, SONAR_MARK_TIME);
        // The Gloamfin hears the pulse and takes a fix on you (specs/predators.md).
        if (p.kind === PredKind.Gloamfin)
          this.alertAcquire(p, this.forager.col, this.forager.row);
      }
      // The bonus drifters are amber-light entities too: a pulse does not reveal
      // them, so there is nothing to mark here (specs/sensing.md).
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
      depthMult: 1,
      predators: this.predators,
      drifters: this.drifters,
      rand: this.rng,
      inkAt: this.inkAt,
      inkBetween: this.inkBetween,
      spawnWave: this.spawnWave,
    };
    for (const p of this.predators) updatePredator(p, dt, world);

    // Bonus drifters.
    this.updateDrifters(dt);

    // Advance every traveling sonar pulse: reveal the tiles its front reaches
    // this step and sense any mover it sweeps over (a ping cast this tick by the
    // forager or the Gloamfin starts traveling out on the next).
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
      advance(
        d,
        dt,
        this.maze,
        () => wanderDir(d, this.maze, this.rng),
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

  // Whether a mover is currently revealed: lit by your passive light, or inside its
  // sonar-mark window. Used for the Gloamfin and Flarefish, which a pulse marks; the
  // amber-light drifter and Lanternjaw are excluded (sonar does not reveal them —
  // they show only their always-visible bulb; see render.ts and specs/sensing.md).
  entityVisible(col: number, row: number, markT: number): boolean {
    if (markT > 0) return true;
    if (this.fog.isLit(col, row)) return true;
    return false;
  }

  diveNumber(): number {
    return Math.max(1, Math.ceil(this.diveT / DIVE_STEP));
  }

  // ---- debugging & automation API (specs/instrumentation.md) -----------
  // These route through the same systems normal play uses. A control op only
  // arranges a precondition; what a caller then observes is produced by stepping
  // the real simulation, never announced by the op itself.

  // Return to the initial title state, seeding all randomness, and re-arm manual
  // stepping (the driver clocks the sim from here via step()).
  debugReset(seed?: number): void {
    this.reseed(seed ?? this.seed);
    this.state = GameState.Title;
    this.menu = 0;
    this.time = 0;
    this.score = 0;
    this.lives = START_LIVES;
    this.depth = 1;
    this.buildTrench(true);
    this.autoStep = false;
  }

  // Turn automatic (wall-clock) stepping on or off. Input and the other control
  // ops do not change it.
  debugSetAutoStep(enabled: boolean): void {
    this.autoStep = enabled;
  }

  // Begin a dive, exactly as choosing DIVE from the title menu (opens on the
  // pre-start dive countdown).
  debugStartDive(): void {
    this.newGame();
  }

  // End the dive countdown now, entering live play immediately.
  debugBeginPlay(): void {
    if (this.state === GameState.Dive) {
      this.diveT = 0;
      this.state = GameState.Playing;
    }
  }

  // Set the current depth; the real depth-scaling then governs the derived values —
  // the predator roster (how many of each) and the sonar range — which recompute from
  // `depth`. Rebuild the roster and return them to the den so a caller reads the
  // scaled results back (specs/instrumentation.md, specs/progression.md).
  debugSetDepth(d: number): void {
    this.depth = Math.max(1, Math.round(d));
    this.buildPredators();
    this.denPredators();
  }

  // Place the forager, at rest, on an open corridor tile (snapped to its center
  // through the same coordinate frame play uses). Injected input then moves it
  // through the game's normal movement code.
  debugSetForager(state: { tx?: number; ty?: number; dir?: string }): void {
    const f = this.forager;
    if (
      state.tx !== undefined &&
      state.ty !== undefined &&
      this.maze.foragerOpen(state.tx, state.ty)
    ) {
      f.x = Maze.cx(state.tx);
      f.y = Maze.cy(state.ty);
    }
    f.dir = Dir.None; // at rest, as if no movement key is held
    const d = state.dir ? strToDir(state.dir) : Dir.None;
    if (d !== Dir.None) f.facing = d;
  }

  // Set the forager's brightness G directly as a precondition. The real formulas
  // (V, the detection ranges) recompute from it. Arms the same hold-before-decay
  // window a fresh pellet would, so G behaves as if just eaten.
  debugSetBrightness(g: number): void {
    this.forager.g = Math.max(0, Math.min(1, g));
    this.brightHold = BRIGHT_HOLD;
  }

  // Pose a predator, then let its own AI run when the sim is stepped.
  debugSetPredator(
    kind: string,
    state: { tx?: number; ty?: number; dir?: string; mode?: string },
  ): void {
    const k = kindFromStr(kind);
    const p = this.predators.find((pp) => pp.kind === k);
    if (!p) return;
    const mode = state.mode ?? "wander";
    if (mode === "den") {
      // Return it to the den chamber; it idles there until the sim runs it out.
      const denCol = k === PredKind.Gloamfin ? 18 : k === PredKind.Flarefish ? 16 : 17;
      p.x = Maze.cx(denCol);
      p.y = Maze.cy(8);
    } else if (
      state.tx !== undefined &&
      state.ty !== undefined &&
      this.maze.foragerOpen(state.tx, state.ty)
    ) {
      p.x = Maze.cx(state.tx);
      p.y = Maze.cy(state.ty);
    }
    const d = state.dir ? strToDir(state.dir) : Dir.None;
    if (d !== Dir.None) {
      p.dir = d;
      p.facing = d;
    }
    p.blindT = 0;
    p.markT = 0;
    p.alertT = 0;
    p.flaring = false;
    if (mode === "chase") {
      // Fixed on the forager's current tile and pursuing through the real AI.
      p.state = PredState.Hunt;
      p.hasFix = true;
      p.fixCol = this.forager.col;
      p.fixRow = this.forager.row;
      p.searching = false;
      p.linger = 5; // ample chase linger so the fix holds across a short scenario
      p.chaseSpeed = GLOAMFIN_CHASE_SPEED;
    } else if (mode === "den") {
      p.state = PredState.Den;
      p.denTimer = 999; // idle in the den (precondition)
      p.hasFix = false;
      p.searching = false;
      p.linger = 0;
    } else {
      // wander (patrolling, not fixed on you)
      p.state = PredState.Patrol;
      p.hasFix = false;
      p.searching = false;
      p.linger = 0;
    }
  }

  // Add a bonus drifter (default at the den gate), which then wanders through the
  // real drifter code.
  debugSpawnDrifter(state?: { tx?: number; ty?: number }): void {
    const tx = state?.tx ?? GATE_COL;
    const ty = state?.ty ?? GATE_ROW - 1;
    this.drifters.push(new Drifter(tx, ty, DRIFTER_SPEED));
  }

  // Leave exactly one plankton, on an open tile adjacent to the forager, so the
  // forager eating it clears the trench and descends through the real path.
  debugPoseLastPlankton(): void {
    this.plankton.fill(false);
    this.planktonLeft = 0;
    const f = this.forager;
    const neighbors: [number, number][] = [
      [0, -1],
      [0, 1],
      [-1, 0],
      [1, 0],
    ];
    for (const [dc, dr] of neighbors) {
      const c = f.col + dc;
      const r = f.row + dr;
      if (this.maze.foragerOpen(c, r) && !this.maze.isWrapEdge(c, r)) {
        this.plankton[tileKey(c, r)] = true;
        this.planktonLeft = 1;
        return;
      }
    }
    // Fallback: on the forager's own tile.
    this.plankton[tileKey(f.col, f.row)] = true;
    this.planktonLeft = 1;
  }

  // Make the sonar pulse and ink immediately ready.
  debugClearCooldowns(): void {
    this.sonarCd = 0;
    this.inkCd = 0;
  }

  // A pure, JSON-serializable read of the full observable state
  // (specs/instrumentation.md#snapshot-shape).
  debugSnapshot(): FathomSnapshot {
    const tiles: string[] = [];
    const visibility: string[] = [];
    for (let r = 0; r < ROWS; r++) {
      let trow = "";
      let vrow = "";
      for (let c = 0; c < COLS; c++) {
        trow += this.maze.isWall(c, r)
          ? "#"
          : this.maze.isGate(c, r)
            ? "g"
            : this.maze.isDen(c, r)
              ? "d"
              : ".";
        vrow += this.fog.isLit(c, r)
          ? "l"
          : this.fog.isRevealed(c, r)
            ? "r"
            : "u";
      }
      tiles.push(trow);
      visibility.push(vrow);
    }

    const f = this.forager;
    const predators = this.predators.map((p) => {
      const isLantern = p.kind === PredKind.Lanternjaw;
      const isGloam = p.kind === PredKind.Gloamfin;
      const isFlare = p.kind === PredKind.Flarefish;
      const stateStr =
        p.state === PredState.Den
          ? "den"
          : isGloam && p.searching
            ? "search"
            : p.state === PredState.Hunt
              ? "chase"
              : "wander";
      const lit =
        p.alertT > 0 ||
        (isFlare && p.flaring) ||
        (isLantern
          ? this.fog.isLit(p.col, p.row)
          : p.markT > 0 || this.fog.isLit(p.col, p.row));
      const inFlare = isFlare && p.flaring;
      const charging = inFlare && p.flarePhaseT < FLARE_CHARGE;
      const fadeEnd = FLARE_CHARGE + FLARE_BLOOM + FLARE_FADE;
      const burning =
        inFlare && p.flarePhaseT >= FLARE_CHARGE && p.flarePhaseT < fadeEnd;
      return {
        kind: kindStr(p.kind),
        x: p.x,
        y: p.y,
        tx: p.col,
        ty: p.row,
        dir: dirStr(p.dir !== Dir.None ? p.dir : p.facing),
        state: stateStr,
        speed: p.speed,
        alert: p.alertT > 0,
        lit,
        detectRange:
          isLantern || isFlare
            ? LANTERNJAW_RANGE_BASE + LANTERNJAW_RANGE_GAIN * f.g
            : null,
        hearingRange: isGloam ? GLOAMFIN_HEAR_RANGE : null,
        // Whether the Gloamfin currently holds a continuous close-range hearing
        // lock on the forager (within its hearing range this instant). While this
        // is true it stays silent — it re-pings only once the forager slips back
        // out of range (specs/predators.md).
        hearingLock: isGloam
          ? Math.hypot(p.x - f.x, p.y - f.y) <= GLOAMFIN_HEAR_RANGE
          : null,
        flareCharging: charging,
        flaring: burning,
        flareRadius: burning ? FLARE_RADIUS : 0,
      };
    });

    return {
      version: 1,
      screen: screenStr(this.state),
      depth: this.depth,
      score: this.score,
      lives: this.lives,
      muted: this.audio.muted,
      planktonRemaining: this.planktonLeft,
      brightness: f.g,
      visionRadius: this.visionRadius,
      windowRadius: this.visionCircle,
      sonar: {
        ready: this.sonarCd <= 0,
        cooldown: this.sonarCd,
        range: sonarRange(this.depth),
      },
      ink: { ready: this.inkCd <= 0, cooldown: this.inkCd },
      grid: {
        cols: COLS,
        rows: ROWS,
        tile: TILE,
        originX: GRID_X,
        originY: GRID_Y,
      },
      tiles,
      visibility,
      forager: {
        x: f.x,
        y: f.y,
        tx: f.col,
        ty: f.row,
        dir: dirStr(f.dir !== Dir.None ? f.dir : f.facing),
        moving: f.dir !== Dir.None,
      },
      drifters: this.drifters.map((d) => ({
        x: d.x,
        y: d.y,
        tx: d.col,
        ty: d.row,
      })),
      predators,
      pulses: this.waves.map((w) => {
        const origin = w.buckets[0][0];
        return {
          source: w.violet ? "gloamfin" : "forager",
          tint: w.violet ? (w.orange ? "orange" : "violet") : "cyan",
          ox: origin.col,
          oy: origin.row,
          front: w.front,
          range: w.maxDist,
        };
      }),
      inkClouds: this.clouds.map((c) => ({
        x: c.x,
        y: c.y,
        radius: INK_RADIUS,
        remaining: c.life,
      })),
      simTime: this.time,
    };
  }
}

// ---- snapshot types & small mappers ------------------------------------

export interface PredatorSnapshot {
  kind: string;
  x: number;
  y: number;
  tx: number;
  ty: number;
  dir: string;
  state: string;
  speed: number;
  alert: boolean;
  lit: boolean;
  detectRange: number | null;
  hearingRange: number | null;
  hearingLock: boolean | null;
  flareCharging: boolean;
  flaring: boolean;
  flareRadius: number;
}

export interface FathomSnapshot {
  version: number;
  screen: string;
  depth: number;
  score: number;
  lives: number;
  muted: boolean;
  planktonRemaining: number;
  brightness: number;
  visionRadius: number;
  windowRadius: number;
  sonar: { ready: boolean; cooldown: number; range: number };
  ink: { ready: boolean; cooldown: number };
  grid: {
    cols: number;
    rows: number;
    tile: number;
    originX: number;
    originY: number;
  };
  tiles: string[];
  visibility: string[];
  forager: {
    x: number;
    y: number;
    tx: number;
    ty: number;
    dir: string;
    moving: boolean;
  };
  drifters: { x: number; y: number; tx: number; ty: number }[];
  predators: PredatorSnapshot[];
  pulses: {
    source: string;
    tint: string;
    ox: number;
    oy: number;
    front: number;
    range: number;
  }[];
  inkClouds: { x: number; y: number; radius: number; remaining: number }[];
  simTime: number;
}

function dirStr(d: Dir): string {
  switch (d) {
    case Dir.Up:
      return "up";
    case Dir.Down:
      return "down";
    case Dir.Left:
      return "left";
    case Dir.Right:
      return "right";
    default:
      return "none";
  }
}

function strToDir(s: string): Dir {
  switch (s) {
    case "up":
      return Dir.Up;
    case "down":
      return Dir.Down;
    case "left":
      return Dir.Left;
    case "right":
      return Dir.Right;
    default:
      return Dir.None;
  }
}

function kindStr(k: PredKind): string {
  switch (k) {
    case PredKind.Lanternjaw:
      return "lanternjaw";
    case PredKind.Gloamfin:
      return "gloamfin";
    default:
      return "flarefish";
  }
}

function kindFromStr(s: string): PredKind {
  switch (s) {
    case "gloamfin":
      return PredKind.Gloamfin;
    case "flarefish":
      return PredKind.Flarefish;
    default:
      return PredKind.Lanternjaw;
  }
}

function screenStr(s: GameState): string {
  switch (s) {
    case GameState.Title:
      return "title";
    case GameState.HowTo:
      return "howto";
    case GameState.Dive:
      return "countdown";
    case GameState.Playing:
      return "playing";
    case GameState.Paused:
      return "paused";
    case GameState.Cleared:
      return "cleared";
    default:
      return "gameover";
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
