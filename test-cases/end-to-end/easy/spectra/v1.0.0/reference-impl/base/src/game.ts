// Spectra — the game: state machine, the two-band polarity combat, the swaying
// formation, the three drones' entrances and dives, the resonance/discharge
// economy, lives and stage scaling, challenge stages, and the Prism's spectral
// inversion. Simulation runs on a fixed timestep (main.ts) decoupled from render.
//
// See specs/polarity.md (bands, shield, discharge), specs/controls.md,
// specs/drones.md (drones), specs/gameplay.md (stages, scoring, states), and
// specs/playfield.md (geometry).

import {
  CYAN,
  DISCHARGE_MAX_R,
  DISCHARGE_TIME,
  DIVE_FIRST_DELAY,
  DIVE_GAP_MAX,
  DIVE_GAP_MIN,
  EBULLET_HIT_R,
  EBULLET_SPEED,
  ENTER_SPEED,
  FIELD_W,
  EXTRA_LIFE_AT,
  FIRE_CADENCE,
  FLIP_LOCKOUT,
  FLUX_SHIMMER,
  FLUX_SIZE,
  INVERSION_TIME,
  MAGENTA,
  PBULLET_CAP,
  PBULLET_SPEED,
  PLAY_BOTTOM,
  PLAY_TOP,
  PRISM_INVERT_Y,
  PRISM_SIZE,
  READY_HOLD,
  RES_ABSORB,
  RES_KILL,
  RES_MAX,
  SCORE,
  SHARD_SIZE,
  SHIP_HIT_R,
  SHIP_MAX_X,
  SHIP_MIN_X,
  SHIP_SPEED,
  SHIP_Y,
  STAGE_CLEARED_TIME,
  STAGE_INTRO_TIME,
  START_LIVES,
  DIVE_SPEED,
  bandName,
  bandStr,
  parseBand,
  diveGapMult,
  droneSpeedMult,
  enemyBulletMult,
  fluxHoldFor,
  isChallengeStage,
  opposite,
  swayOffset,
  type Band,
  type BandStr,
} from "./constants";
import { makeRng, DEFAULT_SEED } from "./rng";
import type { Assets } from "./assets";
import { Audio } from "./audio";
import { Bursts } from "./particles";
import { smoothPath, type Vec2 } from "./paths";
import {
  Input,
  heldFire,
  heldLeft,
  heldRight,
  isBack,
  isConfirm,
  isDischarge,
  isFlip,
  isMenuDown,
  isMenuUp,
  isMute,
  isPause,
} from "./input";
import { buildChallenge, buildWave, type Entrant } from "./waves";
import type { Bullet, Drone, DroneKind, DronePhase, GameState } from "./types";

const TITLE_MENU = ["LAUNCH", "HOW TO PLAY"];
const PAUSE_MENU = ["RESUME", "RESTART", "QUIT TO MENU"];
const GAMEOVER_MENU = ["PLAY AGAIN", "MENU"];

export class Game {
  state: GameState = "title";
  menuIndex = 0;

  // Run state.
  score = 0;
  stage = 1;
  lives = START_LIVES;
  resonance = 0;
  extraLifeGiven = false;
  stageReached = 1;

  // Ship.
  shipX = 640;
  shipBand: Band = CYAN;
  private fireCd = 0;
  private lockout = 0;
  shipAlive = true;
  readyTimer = 0;

  // Field.
  drones: Drone[] = [];
  private entrants: Entrant[] = [];
  bullets: Bullet[] = [];
  readonly bursts: Bursts;

  // Timers.
  waveTime = 0; // seconds since the wave's drones began entering (drives sway)
  private diveTimer = 0;
  private formationAssembled = false;
  stateTimer = 0; // generic per-state hold clock

  // Discharge (specs/polarity.md).
  dischargeActive = false;
  dischargeR = 0;
  private dischargeTimer = 0;

  // Spectral inversion (specs/drones.md).
  inversionTimer = 0;

  // Challenge stage bookkeeping.
  isChallenge = false;
  private challengeDestroyed = 0;
  private challengeReleased = false;
  challengeResult = "";

  readonly audio = new Audio();

  // Accumulated simulation time (seconds), advanced by every fixed step.
  simTime = 0;

  // ---- Debug / automation state (see debug.ts; inert in normal play) --------
  // The manual step clock (specs/instrumentation.md). While true (ordinary play)
  // the animation-frame loop advances the sim from the wall clock; while false
  // it renders every frame but advances only when step() is called. reset() and
  // step() set it false; setAutoStep toggles it.
  autoStep = true;
  // The swarm's own movement and decision-making (specs/instrumentation.md).
  // True in ordinary play. While false the drones hold station — the formation
  // stops swaying and no path advances — no further entrant is released, the
  // assault launches no dives, and no drone fires. Everything else (the ship,
  // bullets in flight, collisions, the discharge, scoring, the stage-end check,
  // and a Flux's band clock) runs exactly as usual. reset() restores it.
  droneAI = true;
  // When on, render.ts draws the read-only debug overlay. Toggled with backtick;
  // off by default; never affects gameplay.
  debugOverlay = false;
  // All of the game's randomness runs through this seedable generator, so
  // reset({ seed }) reproduces a run exactly (specs/instrumentation.md).
  private rng: () => number = makeRng(DEFAULT_SEED);
  // Monotonic source of stable drone ids.
  private nextDroneId = 1;

  constructor(
    private readonly input: Input,
    private readonly assets: Assets,
  ) {
    this.bursts = new Bursts(assets.burst);
    this.input.onFirstPress(() => this.audio.resume());
  }

  get inversionActive(): boolean {
    return this.inversionTimer > 0;
  }

  // The band a stored band reads/counts as right now (swapped during inversion).
  private eff(b: Band): Band {
    return this.inversionActive ? opposite(b) : b;
  }

  // ---- Edge input (once per frame) ----------------------------------------
  handleInput(): void {
    for (const code of this.input.drain()) {
      if (isMute(code)) {
        this.audio.toggleMute();
        continue;
      }
      if (code === "Backquote") {
        // Toggle the read-only debug overlay (specs/instrumentation.md).
        this.debugOverlay = !this.debugOverlay;
        continue;
      }
      switch (this.state) {
        case "title":
          this.menuNav(code, TITLE_MENU.length, () => {
            if (this.menuIndex === 0) this.startGame();
            else this.state = "howto";
          });
          break;
        case "howto":
          if (isConfirm(code) || isBack(code)) this.state = "title";
          break;
        case "inWave":
          if (isPause(code)) {
            this.state = "paused";
            this.menuIndex = 0;
          } else if (isFlip(code)) {
            this.flip();
          } else if (isDischarge(code)) {
            this.tryDischarge();
          }
          break;
        case "paused":
          if (isPause(code)) {
            this.state = "inWave";
          } else {
            this.menuNav(code, PAUSE_MENU.length, () => {
              if (this.menuIndex === 0) this.state = "inWave";
              else if (this.menuIndex === 1) this.startGame();
              else this.toTitle();
            });
            if (isBack(code)) this.state = "inWave";
          }
          break;
        case "gameOver":
          this.menuNav(code, GAMEOVER_MENU.length, () => {
            if (this.menuIndex === 0) this.startGame();
            else this.toTitle();
          });
          break;
        case "stageIntro":
        case "stageCleared":
          // Non-interactive holds.
          break;
      }
    }
  }

  private menuNav(code: string, count: number, confirm: () => void): void {
    if (isMenuUp(code)) this.menuIndex = (this.menuIndex + count - 1) % count;
    else if (isMenuDown(code)) this.menuIndex = (this.menuIndex + 1) % count;
    else if (isConfirm(code)) confirm();
  }

  private toTitle(): void {
    this.state = "title";
    this.menuIndex = 0;
  }

  // ---- Game / stage setup -------------------------------------------------
  private startGame(): void {
    this.score = 0;
    this.stage = 1;
    this.lives = START_LIVES;
    this.resonance = 0;
    this.extraLifeGiven = false;
    this.shipBand = CYAN;
    this.beginStage();
  }

  private beginStage(): void {
    this.stageReached = this.stage;
    this.isChallenge = isChallengeStage(this.stage);
    this.drones = [];
    this.bullets = [];
    this.bursts.clear();
    this.entrants = [];
    this.waveTime = 0;
    this.diveTimer = DIVE_FIRST_DELAY;
    this.formationAssembled = false;
    this.dischargeActive = false;
    this.dischargeR = 0;
    this.dischargeTimer = 0;
    this.inversionTimer = 0;
    this.challengeDestroyed = 0;
    this.challengeReleased = false;
    this.challengeResult = "";
    this.shipX = 640;
    this.shipAlive = true;
    this.readyTimer = 0;
    this.fireCd = 0;
    this.lockout = 0;
    this.state = "stageIntro";
    this.stateTimer = STAGE_INTRO_TIME;
  }

  private launchWave(): void {
    if (this.isChallenge) {
      const cs = buildChallenge();
      this.entrants = cs.map((c) => ({ drone: c.drone, releaseAt: c.releaseAt }));
      this.challengeReleased = false;
    } else {
      this.entrants = buildWave(this.stage, this.rng);
    }
    // Assign each freshly-built drone a stable id.
    for (const e of this.entrants) e.drone.id = this.nextDroneId++;
  }

  // ---- Fixed-step simulation ----------------------------------------------
  fixedStep(dt: number): void {
    switch (this.state) {
      case "stageIntro":
        this.stateTimer -= dt;
        if (this.stateTimer <= 0) {
          this.launchWave();
          this.state = "inWave";
          this.waveTime = 0;
        }
        break;
      case "inWave":
        this.stepWave(dt);
        break;
      case "stageCleared":
        this.stateTimer -= dt;
        if (this.stateTimer <= 0) {
          this.stage++;
          this.beginStage();
        }
        break;
      // title / howto / paused / gameOver are static.
    }
    this.simTime += dt;
  }

  // Visual-only advance (particles). Real time so bursts read smoothly.
  updateVisual(dt: number): void {
    if (this.state === "paused") return;
    this.bursts.update(dt);
  }

  private stepWave(dt: number): void {
    this.waveTime += dt;

    // Timers.
    if (this.lockout > 0) this.lockout = Math.max(0, this.lockout - dt);
    if (this.fireCd > 0) this.fireCd = Math.max(0, this.fireCd - dt);
    if (this.inversionTimer > 0) this.inversionTimer = Math.max(0, this.inversionTimer - dt);

    // Release entrants whose time has come. Held while the swarm's AI is off:
    // a frozen field must not grow underneath a posed scenario.
    if (this.droneAI && this.entrants.length > 0) {
      const still: Entrant[] = [];
      for (const e of this.entrants) {
        if (this.waveTime >= e.releaseAt) this.drones.push(e.drone);
        else still.push(e);
      }
      this.entrants = still;
      if (this.isChallenge && this.entrants.length === 0) this.challengeReleased = true;
    }

    // Ship / READY hold.
    if (this.readyTimer > 0) {
      this.readyTimer -= dt;
      if (this.readyTimer <= 0) {
        this.shipX = 640;
        this.shipAlive = true;
      }
    } else if (this.shipAlive) {
      this.stepShip(dt);
    }

    this.stepDrones(dt);
    this.stepBullets(dt);
    this.stepDischarge(dt);
    this.collisions();
    if (this.droneAI) this.maybeDive(dt);
    this.checkStageEnd();
  }

  // ---- Ship ---------------------------------------------------------------
  private stepShip(dt: number): void {
    let dir = 0;
    if (heldLeft(this.input)) dir -= 1;
    if (heldRight(this.input)) dir += 1;
    this.shipX = Math.max(
      SHIP_MIN_X,
      Math.min(SHIP_MAX_X, this.shipX + dir * SHIP_SPEED * dt),
    );

    if (heldFire(this.input) && this.fireCd <= 0 && this.lockout <= 0) {
      const live = this.bullets.filter((b) => b.friendly && !b.dead).length;
      if (live < PBULLET_CAP) {
        this.bullets.push({
          x: this.shipX,
          y: SHIP_Y - 16,
          vx: 0,
          vy: -PBULLET_SPEED,
          band: this.shipBand,
          friendly: true,
          dead: false,
        });
        this.fireCd = FIRE_CADENCE;
        this.audio.play("fire");
      }
    }
  }

  private flip(): void {
    this.shipBand = opposite(this.shipBand);
    this.lockout = FLIP_LOCKOUT;
    this.audio.play("flip");
  }

  private tryDischarge(): void {
    if (this.resonance < RES_MAX || this.dischargeActive) return;
    this.resonance = 0;
    this.dischargeActive = true;
    this.dischargeR = 0;
    this.dischargeTimer = DISCHARGE_TIME;
    this.audio.play("discharge");
  }

  // ---- Drones -------------------------------------------------------------
  private stepDrones(dt: number): void {
    const sway = swayOffset(this.waveTime);
    const speedMult = this.isChallenge ? 1 : droneSpeedMult(this.stage);

    for (const d of this.drones) {
      if (d.dead) continue;
      // The Flux's band clock is the drone's own oscillation, not its movement,
      // so it keeps running while the swarm is held — a frozen Flux still
      // shimmers and settles on the beat (specs/instrumentation.md).
      this.updateFlux(d, dt);
      // Held: keep the phase and the position exactly as they stand.
      if (!this.droneAI) continue;

      switch (d.phase) {
        case "entering": {
          d.pathDist += ENTER_SPEED * speedMult * dt;
          const p = d.path!.at(d.pathDist);
          d.x = p.x;
          d.y = p.y;
          if (d.pathDist >= d.path!.length) {
            d.phase = "formation";
            d.path = null;
          }
          break;
        }
        case "formation": {
          d.x = d.slotX + sway;
          d.y = d.slotY;
          break;
        }
        case "diving": {
          d.pathDist += DIVE_SPEED * speedMult * dt;
          const p = d.path!.at(d.pathDist);
          const prevY = d.y;
          d.x = p.x;
          d.y = p.y;
          this.diveFire(d);
          // A diving Prism reaching the bottom triggers a spectral inversion
          // (instead of being destroyed) and returns toward its slot.
          if (
            d.kind === "prism" &&
            !this.isChallenge &&
            !d.invertedThisDive &&
            prevY < PRISM_INVERT_Y &&
            d.y >= PRISM_INVERT_Y
          ) {
            this.triggerInversion();
            d.invertedThisDive = true;
            this.startReturn(d, sway);
            break;
          }
          // Exit through the bottom → wrap from the top and return to the slot.
          if (d.y > PLAY_BOTTOM + 48) {
            if (this.isChallenge) {
              d.dead = true; // a challenge flyover simply exits
            } else {
              d.x = this.wrapX(d.x);
              d.y = PLAY_TOP - 40;
              this.startReturn(d, sway);
            }
          } else if (d.pathDist >= d.path!.length) {
            if (this.isChallenge) {
              d.dead = true; // a challenge flyover has swept across and exited
            } else {
              // A loop-back dive ends by rejoining the slot.
              this.startReturn(d, sway);
            }
          }
          break;
        }
        case "returning": {
          d.pathDist += DIVE_SPEED * speedMult * dt;
          const p = d.path!.at(d.pathDist);
          d.x = p.x;
          d.y = p.y;
          if (d.pathDist >= d.path!.length) {
            d.phase = "formation";
            d.path = null;
            d.invertedThisDive = false;
          }
          break;
        }
      }
    }

    // Reap the dead.
    this.drones = this.drones.filter((d) => !d.dead);
  }

  private wrapX(x: number): number {
    return Math.max(60, Math.min(1220, x));
  }

  private startReturn(d: Drone, sway: number): void {
    const tx = d.slotX + sway;
    const knots: Vec2[] = [
      { x: d.x, y: d.y },
      { x: (d.x + tx) / 2, y: Math.max(PLAY_TOP + 20, d.slotY - 80) },
      { x: tx, y: d.slotY },
    ];
    d.phase = "returning";
    d.path = smoothPath(knots);
    d.pathDist = 0;
  }

  private updateFlux(d: Drone, dt: number): void {
    if (d.kind !== "flux") return;
    d.fluxClock += dt;
    const hold = fluxHoldFor(this.stage);
    const cycle = 2 * hold + 2 * FLUX_SHIMMER;
    let t = d.fluxClock % cycle;
    if (t < hold) {
      d.band = d.fluxBase;
      d.shimmer = false;
    } else if (t < hold + FLUX_SHIMMER) {
      d.shimmer = true;
    } else if (t < 2 * hold + FLUX_SHIMMER) {
      d.band = opposite(d.fluxBase);
      d.shimmer = false;
    } else {
      d.shimmer = true;
    }
  }

  private diveFire(d: Drone): void {
    if (this.isChallenge) return; // challenge drones never fire
    if (d.fireAt.length === 0) return;
    const next = d.fireAt[0]!;
    if (d.pathDist < next) return;
    d.fireAt.shift();
    // Do not fire below the ship's lane, and never from within the bottom strip.
    if (d.y > SHIP_Y || d.y < PLAY_TOP) return;
    const spd = EBULLET_SPEED * enemyBulletMult(this.stage);
    const aim = Math.max(-0.35, Math.min(0.35, (this.shipX - d.x) / 400));
    if (d.kind === "prism") {
      // A two-band burst: one cyan, one magenta (specs/drones.md).
      this.spawnEnemyBullet(d.x - 6, d.y, aim, spd, CYAN);
      this.spawnEnemyBullet(d.x + 6, d.y, aim, spd, MAGENTA);
    } else if (d.kind === "flux") {
      if (d.shimmer) return; // a Flux does not fire mid-shimmer
      this.spawnEnemyBullet(d.x, d.y, aim, spd, d.band);
    } else {
      this.spawnEnemyBullet(d.x, d.y, aim, spd, d.band);
    }
  }

  private spawnEnemyBullet(x: number, y: number, aim: number, spd: number, band: Band): void {
    this.bullets.push({
      x,
      y,
      vx: aim * spd,
      vy: spd,
      band,
      friendly: false,
      dead: false,
    });
  }

  // ---- Dive selection -----------------------------------------------------
  private maybeDive(dt: number): void {
    if (this.isChallenge) return;
    if (!this.formationAssembled) {
      const anyEntering =
        this.entrants.length > 0 || this.drones.some((d) => d.phase === "entering");
      if (!anyEntering && this.drones.length > 0) {
        this.formationAssembled = true;
        this.diveTimer = DIVE_FIRST_DELAY;
      }
      return;
    }
    this.diveTimer -= dt;
    if (this.diveTimer > 0) return;
    const gap =
      (DIVE_GAP_MIN + this.rng() * (DIVE_GAP_MAX - DIVE_GAP_MIN)) *
      diveGapMult(this.stage);
    this.diveTimer = gap;
    const pair = this.rng() < 0.25 ? 2 : 1;
    for (let i = 0; i < pair; i++) this.launchDive();
  }

  private launchDive(): void {
    const candidates = this.drones.filter((d) => d.phase === "formation");
    if (candidates.length === 0) return;
    const d = candidates[Math.floor(this.rng() * candidates.length)]!;
    this.diveDrone(d);
  }

  // Send a specific formation drone into a real dive. Shared by the automatic
  // assault (launchDive) and the debug API's forceDive (specs/instrumentation.md),
  // so a driven dive is byte-for-byte a played one.
  private diveDrone(d: Drone): void {
    const exit = this.rng() < 0.4;
    const px = this.shipX; // snapshot: the dive bends toward the player, not homing
    const startX = d.x;
    const startY = d.y;
    const side = startX < 640 ? 1 : -1;
    let knots: Vec2[];
    if (exit) {
      knots = [
        { x: startX, y: startY },
        { x: startX + side * 120, y: 300 },
        { x: px, y: 460 },
        { x: px + side * 40, y: 600 },
        { x: px + side * 60, y: 760 },
      ];
    } else {
      // Loop-back: swoop toward the player then curve back up (turning before the
      // bottom HUD strip) to rejoin the slot.
      knots = [
        { x: startX, y: startY },
        { x: startX + side * 140, y: 320 },
        { x: px, y: 500 },
        { x: px - side * 120, y: 560 },
        { x: d.slotX - side * 100, y: 320 },
      ];
    }
    d.phase = "diving";
    d.path = smoothPath(knots);
    d.pathDist = 0;
    d.invertedThisDive = false;
    const len = d.path.length;
    d.fireAt = d.kind === "prism" ? [len * 0.42] : [len * 0.4];
    if (d.kind !== "prism" && this.rng() < 0.5) d.fireAt.push(len * 0.6);
  }

  // ---- Bullets ------------------------------------------------------------
  private stepBullets(dt: number): void {
    for (const b of this.bullets) {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (b.y < PLAY_TOP - 20 || b.y > PLAY_BOTTOM + 20 || b.x < -20 || b.x > FIELD_W + 20) {
        b.dead = true;
      }
    }
    this.bullets = this.bullets.filter((b) => !b.dead);
  }

  // ---- Discharge ----------------------------------------------------------
  private stepDischarge(dt: number): void {
    if (!this.dischargeActive) return;
    this.dischargeTimer -= dt;
    const frac = 1 - Math.max(0, this.dischargeTimer) / DISCHARGE_TIME;
    this.dischargeR = frac * DISCHARGE_MAX_R;
    // Wipe out-of-formation drones and clear enemy bullets the wave reaches.
    for (const d of this.drones) {
      if (d.dead || d.phase === "formation") continue;
      if (Math.hypot(d.x - this.shipX, d.y - SHIP_Y) <= this.dischargeR) {
        this.destroyDroneOutright(d);
      }
    }
    for (const b of this.bullets) {
      if (b.friendly || b.dead) continue;
      if (Math.hypot(b.x - this.shipX, b.y - SHIP_Y) <= this.dischargeR) b.dead = true;
    }
    if (this.dischargeTimer <= 0) {
      this.dischargeActive = false;
      this.dischargeR = 0;
    }
  }

  // Band-blind destruction (discharge): scores as a diving kill, no resonance.
  private destroyDroneOutright(d: Drone): void {
    d.dead = true;
    this.pop(d);
    this.addScore(this.diveValue(d));
  }

  private diveValue(d: Drone): number {
    if (d.kind === "flux") return SCORE.fluxDive;
    if (d.kind === "prism") return SCORE.prismCore;
    return SCORE.shardDive;
  }

  // ---- Collisions ---------------------------------------------------------
  private collisions(): void {
    // Player bullets vs drones.
    for (const b of this.bullets) {
      if (!b.friendly || b.dead) continue;
      for (const d of this.drones) {
        if (d.dead) continue;
        const r = this.droneRadius(d) + 3; // include the bullet's half-width
        if (Math.hypot(b.x - d.x, b.y - d.y) > r) continue;
        b.dead = true; // any contact absorbs the shot (match destroys, mismatch wasted)
        this.hitDrone(d, b.band);
        break;
      }
    }

    if (!this.shipAlive || this.readyTimer > 0) {
      // Ship absent: enemy bullets still fly, but cannot hit or be absorbed.
      return;
    }

    // Enemy bullets vs ship (the dual-use shield).
    for (const b of this.bullets) {
      if (b.friendly || b.dead) continue;
      if (Math.hypot(b.x - this.shipX, b.y - SHIP_Y) > SHIP_HIT_R + EBULLET_HIT_R) continue;
      b.dead = true;
      if (this.eff(b.band) === this.shipBand) {
        // Same band: absorbed harmlessly, builds resonance.
        this.addResonance(RES_ABSORB);
        this.audio.play("absorb");
      } else {
        this.loseLife();
        return;
      }
    }

    // Drone bodies vs ship — always lethal, regardless of band (not in challenge).
    if (!this.isChallenge) {
      for (const d of this.drones) {
        if (d.dead) continue;
        if (Math.hypot(d.x - this.shipX, d.y - SHIP_Y) <= SHIP_HIT_R + this.droneRadius(d)) {
          this.loseLife();
          return;
        }
      }
    }
  }

  private droneRadius(d: Drone): number {
    if (d.kind === "prism") return (d.shellAlive ? PRISM_SIZE : PRISM_SIZE * 0.42) / 2;
    if (d.kind === "flux") return FLUX_SIZE / 2;
    return SHARD_SIZE / 2;
  }

  // A player bullet of `band` strikes drone `d`.
  private hitDrone(d: Drone, band: Band): void {
    if (this.isChallenge) {
      // Challenge drones are single-band and destroyed by a matching shot.
      if (this.eff(d.band) === band) {
        d.dead = true;
        this.pop(d);
        this.addScore(SCORE.challenge);
        this.challengeDestroyed++;
        this.audio.play("kill");
      }
      return;
    }

    if (d.kind === "prism") {
      if (d.shellAlive) {
        if (this.eff(d.shellBand) === band) {
          d.shellAlive = false;
          d.band = d.coreBand; // the exposed core's band becomes current
          this.pop(d, true); // shell detonation
          this.addScore(SCORE.prismShell); // shell: no resonance
          this.audio.play("kill");
        }
      } else if (this.eff(d.coreBand) === band) {
        d.dead = true;
        this.pop(d);
        this.addScore(SCORE.prismCore);
        this.addResonance(RES_KILL); // core kill feeds resonance
        this.audio.play("kill");
      }
      return;
    }

    if (d.kind === "flux" && d.shimmer) return; // cannot kill mid-shimmer

    if (this.eff(d.band) === band) {
      d.dead = true;
      this.pop(d);
      const diving = d.phase !== "formation";
      const value =
        d.kind === "flux"
          ? diving
            ? SCORE.fluxDive
            : SCORE.fluxForm
          : diving
            ? SCORE.shardDive
            : SCORE.shardForm;
      this.addScore(value);
      this.addResonance(RES_KILL);
      this.audio.play("kill");
    }
  }

  // Play the provided drone-burst at a drone's footprint.
  private pop(d: Drone, shell = false): void {
    const size =
      d.kind === "prism"
        ? shell
          ? PRISM_SIZE
          : PRISM_SIZE * 0.5
        : d.kind === "flux"
          ? FLUX_SIZE
          : SHARD_SIZE;
    this.bursts.spawn(d.x, d.y, size);
  }

  private triggerInversion(): void {
    this.inversionTimer = INVERSION_TIME; // refreshes if already active
    this.audio.play("inversion");
  }

  // ---- Score / resonance / lives ------------------------------------------
  private addScore(n: number): void {
    this.score += n;
    if (!this.extraLifeGiven && this.score >= EXTRA_LIFE_AT) {
      this.extraLifeGiven = true;
      this.lives++;
    }
  }

  private addResonance(n: number): void {
    this.resonance = Math.min(RES_MAX, this.resonance + n);
  }

  private loseLife(): void {
    this.lives--;
    this.shipAlive = false;
    this.audio.play("hit");
    if (this.lives <= 0) {
      this.stageReached = this.stage;
      this.state = "gameOver";
      this.menuIndex = 0;
    } else {
      this.readyTimer = READY_HOLD; // wave continues; resonance is kept
    }
  }

  // ---- Stage end ----------------------------------------------------------
  private checkStageEnd(): void {
    if (this.isChallenge) {
      const done =
        this.challengeReleased && this.entrants.length === 0 && this.drones.length === 0;
      if (done) {
        const perfect = this.challengeDestroyed >= 40;
        if (perfect) {
          this.addScore(SCORE.perfectBonus);
          this.challengeResult = "PERFECT!";
        } else {
          this.challengeResult = `${this.challengeDestroyed} / 40`;
        }
        this.audio.play("clear");
        this.state = "stageCleared";
        this.stateTimer = STAGE_CLEARED_TIME;
      }
      return;
    }
    const cleared =
      this.formationAssembled && this.entrants.length === 0 && this.drones.length === 0;
    if (cleared) {
      this.addScore(SCORE.stageClear);
      this.challengeResult = "";
      this.audio.play("clear");
      this.state = "stageCleared";
      this.stateTimer = STAGE_CLEARED_TIME;
    }
  }

  // ---- Accessors used by render -------------------------------------------
  get bandLabel(): string {
    return bandName(this.shipBand);
  }
  titleMenu(): string[] {
    return TITLE_MENU;
  }
  pauseMenu(): string[] {
    return PAUSE_MENU;
  }
  gameOverMenu(): string[] {
    return GAMEOVER_MENU;
  }
  assetSet(): Assets {
    return this.assets;
  }
  // The band a drone/bullet currently reads as (for rendering under inversion).
  effBand(b: Band): Band {
    return this.eff(b);
  }

  // ---- Debug driver surface (used by debug.ts; inert in normal play) --------
  //
  // Each control method routes through the same transitions, systems, and state
  // the game uses in normal play — it sets up a situation, it never fabricates an
  // outcome. See specs/instrumentation.md.

  setAutoStep(enabled: boolean): void {
    this.autoStep = enabled;
  }

  // Turn the swarm's own movement and decision-making on or off. See the
  // `droneAI` field, and specs/instrumentation.md for the contract.
  debugSetDroneAI(enabled: boolean): void {
    this.droneAI = enabled;
  }

  // Return to the title, reseed all randomness, and re-arm manual stepping.
  debugReset(seed?: number): void {
    this.rng = makeRng(seed ?? DEFAULT_SEED);
    this.nextDroneId = 1;
    this.autoStep = false;
    this.droneAI = true;
    this.input.releaseAll();
    this.simTime = 0;
    this.score = 0;
    this.stage = 1;
    this.lives = START_LIVES;
    this.resonance = 0;
    this.extraLifeGiven = false;
    this.stageReached = 1;
    this.shipX = 640;
    this.shipBand = CYAN;
    this.shipAlive = true;
    this.readyTimer = 0;
    this.fireCd = 0;
    this.lockout = 0;
    this.drones = [];
    this.entrants = [];
    this.bullets = [];
    this.bursts.clear();
    this.waveTime = 0;
    this.diveTimer = 0;
    this.formationAssembled = false;
    this.dischargeActive = false;
    this.dischargeR = 0;
    this.inversionTimer = 0;
    this.isChallenge = false;
    this.challengeDestroyed = 0;
    this.challengeReleased = false;
    this.challengeResult = "";
    this.toTitle();
  }

  // Advance past the stage-intro hold straight into the live wave, launching it
  // through the real wave code.
  private enterWaveNow(): void {
    if (this.state === "stageIntro") {
      this.launchWave();
      this.state = "inWave";
      this.waveTime = 0;
      this.stateTimer = 0;
    }
  }

  // Start this build's mode from the title and land in stage 1's live wave.
  debugStartGame(): void {
    this.startGame();
    this.enterWaveNow();
  }

  // Begin a real stage and enter its live wave directly (its scaled speeds /
  // formation / challenge reachable without playing up).
  debugStartStage(stage: number): void {
    this.stage = stage;
    this.beginStage();
    this.enterWaveNow();
  }

  debugSetShipX(x: number): void {
    this.shipX = Math.max(SHIP_MIN_X, Math.min(SHIP_MAX_X, x));
  }

  debugSetShipBand(band: BandStr): void {
    this.shipBand = parseBand(band); // a precondition: no fire lockout
  }

  debugFlip(): void {
    this.flip(); // a real flip: instant band change + 0.30s lockout
  }

  debugDischarge(): void {
    this.tryDischarge(); // fires only if the meter is full; spends it
  }

  debugSetResonance(value: number): void {
    this.resonance = Math.max(0, Math.min(RES_MAX, value));
  }

  debugSetLives(n: number): void {
    this.lives = n;
  }

  debugSetScore(n: number): void {
    this.score = n; // a raw precondition; award thresholds are crossed by real kills
  }

  // Place one drone into the live wave through real drone construction and reach
  // its requested phase via the real motion systems; return its stable id.
  debugSpawnDrone(spec: SpawnDroneSpec): number {
    const band = parseBand(spec.band);
    const slotX = spec.slotX ?? spec.x;
    const slotY = spec.slotY ?? spec.y;
    const shellBand = spec.shellBand !== undefined ? parseBand(spec.shellBand) : band;
    const coreBand = opposite(shellBand);
    const d: Drone = {
      id: this.nextDroneId++,
      kind: spec.kind,
      band: spec.kind === "prism" ? shellBand : band,
      x: spec.x,
      y: spec.y,
      col: 0,
      row: 0,
      slotX,
      slotY,
      phase: "formation",
      angle: 0,
      dead: false,
      path: null,
      pathDist: 0,
      fireAt: [],
      fluxBase: band,
      fluxClock: spec.fluxClock ?? 0,
      shimmer: false,
      shellBand,
      coreBand,
      shellAlive: spec.kind === "prism",
      invertedThisDive: false,
    };
    this.drones.push(d);
    if (spec.phase === "diving") {
      this.diveDrone(d);
    } else if (spec.phase === "returning") {
      this.startReturn(d, swayOffset(this.waveTime));
    } else if (spec.phase === "entering") {
      d.phase = "entering";
      d.path = smoothPath([
        { x: spec.x, y: spec.y },
        { x: (spec.x + slotX) / 2, y: Math.max(PLAY_TOP + 20, (spec.y + slotY) / 2) },
        { x: slotX, y: slotY },
      ]);
      d.pathDist = 0;
    }
    return d.id;
  }

  debugForceDive(id: number): void {
    const d = this.drones.find((x) => x.id === id && !x.dead);
    if (d) this.diveDrone(d);
  }

  debugSpawnPlayerBullet(spec: SpawnBulletSpec): void {
    this.bullets.push({
      x: spec.x,
      y: spec.y,
      vx: spec.vx ?? 0,
      vy: spec.vy ?? -PBULLET_SPEED,
      band: parseBand(spec.band),
      friendly: true,
      dead: false,
    });
  }

  debugSpawnEnemyBullet(spec: SpawnBulletSpec): void {
    this.bullets.push({
      x: spec.x,
      y: spec.y,
      vx: spec.vx ?? 0,
      vy: spec.vy ?? EBULLET_SPEED * enemyBulletMult(this.stage),
      band: parseBand(spec.band),
      friendly: false,
      dead: false,
    });
  }

  // Remove every drone (formed, entering, diving, pending) and every bullet, so a
  // caller can pose an exact scenario. Stage, score, lives, resonance, and ship
  // are untouched.
  debugClearField(): void {
    this.drones = [];
    this.entrants = [];
    this.bullets = [];
    this.formationAssembled = false;
    this.challengeReleased = false;
  }

  // A read of the full observable state, shared by the debug API's snapshot() and
  // the debug overlay.
  debugSnapshot(): SpectraSnapshot {
    return {
      version: 1,
      screen: this.state,
      menuIndex: this.menuIndex,
      mode: "sortie",
      stage: this.stage,
      isChallenge: this.isChallenge,
      score: this.score,
      lives: this.lives,
      resonance: this.resonance,
      dischargeReady: this.resonance >= RES_MAX && !this.dischargeActive,
      muted: this.audio.muted,
      inversionActive: this.inversionActive,
      ship: {
        x: this.shipX,
        band: bandStr(this.shipBand),
        alive: this.shipAlive,
        canFire: this.shipAlive && this.lockout <= 0 && this.fireCd <= 0,
        lockout: this.lockout,
      },
      discharge: { active: this.dischargeActive, radius: this.dischargeR },
      drones: this.drones.map((d) => ({
        id: d.id,
        kind: d.kind,
        band: bandStr(d.band),
        effectiveBand: bandStr(this.eff(d.band)),
        x: d.x,
        y: d.y,
        phase: d.phase,
        slotX: d.slotX,
        slotY: d.slotY,
        shimmer: d.shimmer,
        shellAlive: d.shellAlive,
        shellBand: bandStr(d.shellBand),
        coreBand: bandStr(d.coreBand),
      })),
      bullets: this.bullets.map((b) => ({
        x: b.x,
        y: b.y,
        vx: b.vx,
        vy: b.vy,
        band: bandStr(b.band),
        effectiveBand: bandStr(b.friendly ? b.band : this.eff(b.band)),
        friendly: b.friendly,
      })),
      bursts: this.bursts.list(),
      simTime: this.simTime,
    };
  }
}

// ---- Debug snapshot shape (specs/instrumentation.md) ----------------------

export interface SpawnDroneSpec {
  kind: DroneKind;
  band: BandStr;
  x: number;
  y: number;
  phase: DronePhase;
  slotX?: number;
  slotY?: number;
  shellBand?: BandStr;
  fluxClock?: number;
}

export interface SpawnBulletSpec {
  x: number;
  y: number;
  band: BandStr;
  vx?: number;
  vy?: number;
}

export interface DroneSnapshot {
  id: number;
  kind: DroneKind;
  band: BandStr;
  effectiveBand: BandStr;
  x: number;
  y: number;
  phase: DronePhase;
  slotX: number;
  slotY: number;
  shimmer: boolean;
  shellAlive: boolean;
  shellBand: BandStr;
  coreBand: BandStr;
}

export interface BulletSnapshot {
  x: number;
  y: number;
  vx: number;
  vy: number;
  band: BandStr;
  effectiveBand: BandStr;
  friendly: boolean;
}

export interface SpectraSnapshot {
  version: number;
  screen: GameState;
  menuIndex: number;
  mode: "sortie" | "overload";
  stage: number;
  isChallenge: boolean;
  score: number;
  lives: number;
  resonance: number;
  dischargeReady: boolean;
  muted: boolean;
  inversionActive: boolean;
  ship: {
    x: number;
    band: BandStr;
    alive: boolean;
    canFire: boolean;
    lockout: number;
  };
  discharge: { active: boolean; radius: number };
  drones: DroneSnapshot[];
  bullets: BulletSnapshot[];
  bursts: Array<{ x: number; y: number; size: number }>;
  simTime: number;
}
