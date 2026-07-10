// Spectra — the game: state machine, the two-band polarity combat, the swaying
// formation, the three drones' entrances and dives, the resonance/discharge
// economy, lives and stage scaling, challenge stages, and the Prism's spectral
// inversion. Simulation runs on a fixed timestep (main.ts) decoupled from render.
//
// See specs/polarity.md (bands, shield, discharge), specs/controls.md,
// specs/enemies.md (drones), specs/flow.md (stages, scoring, states), and
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
  FORM_CENTER_X,
  INVERSION_TIME,
  MAGENTA,
  OVERLOAD_CHARGE,
  OVERLOAD_DIVE_SPEED,
  OVERLOAD_SPREAD,
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
  SLOT_DX,
  SLOT_DY,
  STAGE_CLEARED_TIME,
  STAGE_INTRO_TIME,
  START_LIVES,
  DIVE_SPEED,
  bandName,
  diveGapMult,
  droneSpeedMult,
  enemyBulletMult,
  fluxHoldFor,
  isChallengeStage,
  opposite,
  swayOffset,
  type Band,
} from "./constants";
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
import type { Bullet, Drone, GameState } from "./types";

// This variant seeds Overload alongside the standard Sortie, so the title menu
// lists OVERLOAD between LAUNCH and HOW TO PLAY (see reference/menu-overload.html
// and specs/modes/overload.md "Menu entry").
const TITLE_MENU = ["LAUNCH", "OVERLOAD", "HOW TO PLAY"];
const PAUSE_MENU = ["RESUME", "RESTART", "QUIT TO MENU"];
const GAMEOVER_MENU = ["PLAY AGAIN", "MENU"];

// The selected mode. Sortie is the standard defense; Overload replaces the
// "mismatch is wasted" rule with the charge/overload mechanic (specs/modes/overload.md).
export type Mode = "sortie" | "overload";

export class Game {
  state: GameState = "title";
  menuIndex = 0;
  // Which mode the current (or most recent) run is playing. Restart and Play
  // Again keep this mode; only the title menu changes it.
  mode: Mode = "sortie";

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

  // Spectral inversion (specs/enemies.md).
  inversionTimer = 0;

  // Challenge stage bookkeeping.
  isChallenge = false;
  private challengeDestroyed = 0;
  private challengeReleased = false;
  challengeResult = "";

  readonly audio = new Audio();

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
      switch (this.state) {
        case "title":
          this.menuNav(code, TITLE_MENU.length, () => {
            if (this.menuIndex === 0) this.startGame("sortie");
            else if (this.menuIndex === 1) this.startGame("overload");
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
              else if (this.menuIndex === 1) this.startGame(this.mode);
              else this.toTitle();
            });
            if (isBack(code)) this.state = "inWave";
          }
          break;
        case "gameOver":
          this.menuNav(code, GAMEOVER_MENU.length, () => {
            if (this.menuIndex === 0) this.startGame(this.mode);
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
  private startGame(mode: Mode): void {
    this.mode = mode;
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
      this.entrants = buildWave(this.stage);
    }
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

    // Release entrants whose time has come.
    if (this.entrants.length > 0) {
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
    this.maybeDive(dt);
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
      this.updateFlux(d, dt);

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
          // A Shard in its Overload headlong plunge travels faster than a normal
          // dive (specs/modes/overload.md).
          const diveSpeed = d.headlong ? OVERLOAD_DIVE_SPEED : DIVE_SPEED;
          d.pathDist += diveSpeed * speedMult * dt;
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
    d.headlong = false; // the headlong plunge ends once the drone loops back
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
      // A two-band burst: one cyan, one magenta (specs/enemies.md).
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
      (DIVE_GAP_MIN + Math.random() * (DIVE_GAP_MAX - DIVE_GAP_MIN)) *
      diveGapMult(this.stage);
    this.diveTimer = gap;
    const pair = Math.random() < 0.25 ? 2 : 1;
    for (let i = 0; i < pair; i++) this.launchDive();
  }

  private launchDive(): void {
    const candidates = this.drones.filter((d) => d.phase === "formation");
    if (candidates.length === 0) return;
    const d = candidates[Math.floor(Math.random() * candidates.length)]!;
    const exit = Math.random() < 0.4;
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
    if (d.kind !== "prism" && Math.random() < 0.5) d.fireAt.push(len * 0.6);
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
          d.charge = 0; // a broken layer starts its charge count fresh
          this.pop(d, true); // shell detonation
          this.addScore(SCORE.prismShell); // shell: no resonance
          this.audio.play("kill");
        } else if (this.mode === "overload") {
          this.chargeDrone(d); // wrong band on the shell feeds the Prism
        }
      } else if (this.eff(d.coreBand) === band) {
        d.dead = true;
        this.pop(d);
        this.addScore(SCORE.prismCore);
        this.addResonance(RES_KILL); // core kill feeds resonance
        this.audio.play("kill");
      } else if (this.mode === "overload") {
        this.chargeDrone(d); // wrong band on the exposed core feeds the Prism
      }
      return;
    }

    if (d.kind === "flux" && d.shimmer) return; // no band to match: no kill, no charge

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
    } else if (this.mode === "overload") {
      // Overload: a mismatched offensive shot feeds the drone instead of wasting.
      this.chargeDrone(d);
    }
  }

  // ---- Overload mode (specs/modes/overload.md) ----------------------------
  // A mismatched shot adds a charge; at OVERLOAD_CHARGE the drone overloads with
  // its per-type reaction and its charge resets to 0 (it can overload again).
  private chargeDrone(d: Drone): void {
    d.charge++;
    this.audio.play("flip"); // a short "arming" cue for the fed drone
    if (d.charge >= OVERLOAD_CHARGE) {
      d.charge = 0;
      this.overloadDrone(d);
    }
  }

  private overloadDrone(d: Drone): void {
    this.audio.play("inversion"); // the drone lashes out
    if (d.kind === "shard") this.overloadShard(d);
    else if (d.kind === "flux") this.overloadFlux(d);
    else this.overloadPrism(d);
  }

  // Shard: peel out of formation (or redirect a dive) into a fast, straight
  // headlong plunge down the field toward the player's current x.
  private overloadShard(d: Drone): void {
    const px = this.shipX;
    const knots: Vec2[] = [
      { x: d.x, y: d.y },
      { x: (d.x + px) / 2, y: (d.y + PLAY_BOTTOM) / 2 },
      { x: px, y: PLAY_BOTTOM + 60 },
      { x: px, y: PLAY_BOTTOM + 160 },
    ];
    d.phase = "diving";
    d.path = smoothPath(knots);
    d.pathDist = 0;
    d.headlong = true;
    d.invertedThisDive = false;
    d.fireAt = []; // a headlong Shard rams; it does not stop to fire
  }

  // Flux: flip its band (ending any held window or shimmer) and fire a 3-shot
  // downward spread in its NEW band, then resume its cycle.
  private overloadFlux(d: Drone): void {
    const newBand = opposite(d.band);
    d.fluxBase = newBand;
    d.band = newBand;
    d.fluxClock = 0; // resume the cycle from a fresh held window in the new band
    d.shimmer = false;
    const spd = EBULLET_SPEED * enemyBulletMult(this.stage);
    this.spawnEnemyBullet(d.x, d.y, -OVERLOAD_SPREAD, spd, newBand);
    this.spawnEnemyBullet(d.x, d.y, 0, spd, newBand);
    this.spawnEnemyBullet(d.x, d.y, OVERLOAD_SPREAD, spd, newBand);
  }

  // Prism: the exposed layer emits a two-band burst (one cyan, one magenta); if
  // the shell is the exposed layer, one extra Shard escort (random band) spawns.
  private overloadPrism(d: Drone): void {
    const spd = EBULLET_SPEED * enemyBulletMult(this.stage);
    const aim = Math.max(-0.35, Math.min(0.35, (this.shipX - d.x) / 400));
    this.spawnEnemyBullet(d.x - 6, d.y, aim, spd, CYAN);
    this.spawnEnemyBullet(d.x + 6, d.y, aim, spd, MAGENTA);
    if (d.shellAlive) this.spawnShardEscort(d);
  }

  // Spawn a fresh Shard escort (random band) that flies in beside the Prism and
  // joins the formation — growing the swarm around a wrongly-fed Prism.
  private spawnShardEscort(prism: Drone): void {
    const band: Band = Math.random() < 0.5 ? CYAN : MAGENTA;
    const side = prism.slotX <= FORM_CENTER_X ? -1 : 1;
    const sx = prism.slotX + side * SLOT_DX * 0.5;
    const sy = prism.slotY + SLOT_DY * 0.5;
    const knots: Vec2[] = [
      { x: sx + side * 260, y: PLAY_TOP - 60 },
      { x: sx + side * 140, y: PLAY_TOP + 60 },
      { x: sx - side * 60, y: sy - 40 },
      { x: sx, y: sy },
    ];
    const path = smoothPath(knots);
    const escort: Drone = {
      kind: "shard",
      band,
      x: sx + side * 260,
      y: PLAY_TOP - 60,
      col: prism.col,
      row: prism.row,
      slotX: sx,
      slotY: sy,
      phase: "entering",
      angle: 0,
      dead: false,
      path,
      pathDist: 0,
      fireAt: [],
      headlong: false,
      charge: 0,
      fluxBase: band,
      fluxClock: 0,
      shimmer: false,
      shellBand: band,
      coreBand: opposite(band),
      shellAlive: false,
      invertedThisDive: false,
    };
    this.drones.push(escort);
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
}
