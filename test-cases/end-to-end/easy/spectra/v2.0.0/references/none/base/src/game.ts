// Spectra — the game: the state, the frame, and every rule the field runs on.
//
// This file is the whole of the simulation. It owns:
//
//   * the state and its two constructors, a fresh one and the title-screen pose
//     `reset` restores (specs/state.md);
//   * the screens and what each one's keys do (specs/ui.md, specs/controls.md);
//   * THE FRAME: a delta divided into whole sub-steps of at most `SUBSTEP_MAX`,
//     each advancing every moving thing by `v * h` and then resolving contacts in
//     the stated order (specs/simulation.md);
//   * the contacts and what each decides — the band rules, the shield, the
//     resonance meter, the discharge, the scoring, the lives, and the stage
//     transitions.
//
// It stands on `src/swarm.ts` for how a drone moves and fires, `src/bands.ts` for
// the one effective-band definition, `src/waves.ts` for what a wave is made of,
// and `src/bursts.ts` for the seeded pop. It draws nothing: `src/render.ts` does,
// from the state this file leaves behind, so what a frame decides never depends
// on what was drawn.

import {
  CHALLENGE_TOTAL,
  DEFAULT_SEED,
  DISCHARGE_MAX_R,
  DISCHARGE_TIME,
  DIVE_FIRST_DELAY,
  ENEMY_BULLET_HALF,
  EXTRA_LIFE_AT,
  FIELD_BOTTOM,
  FIELD_TOP,
  FIRE_INTERVAL,
  FLIP_LOCKOUT,
  GAME_OVER_ITEMS,
  MAX_PLAYER_BULLETS,
  PAUSE_ITEMS,
  PLAYER_BULLET_HALF,
  PLAYER_BULLET_SPEED,
  READY_HOLD,
  RESONANCE_ABSORB,
  RESONANCE_KILL,
  RESONANCE_MAX,
  SCORE_CHALLENGE_DRONE,
  SCORE_FLUX_DIVE,
  SCORE_FLUX_FORM,
  SCORE_PERFECT_BONUS,
  SCORE_PRISM_CORE,
  SCORE_PRISM_SHELL,
  SCORE_SHARD_DIVE,
  SCORE_SHARD_FORM,
  SCORE_STAGE_CLEAR,
  SHIP_H,
  SHIP_HALF,
  SHIP_SPEED,
  SHIP_X_MAX,
  SHIP_X_MIN,
  SHIP_Y,
  STAGE_CLEARED_HOLD,
  STAGE_INTRO_HOLD,
  START_LIVES,
  STARFIELD_MIN,
  SUBSTEP_MAX,
  TITLE_ITEMS,
  ACTIONS,
  BINDINGS,
  isChallengeStage,
  opposite,
  type Band,
} from "./constants";
import {
  droneFootprint,
  droneHalf,
  effectiveBulletBand,
  effectiveDroneBand,
  isShimmering,
  overlaps,
} from "./bands";
import { startBurst, stepBursts } from "./bursts";
import { CUE_SPECS, raise } from "./cues";
import { registerDiagnostics } from "./diagnostics";
import { renderSpectra } from "./render";
import { seedRng } from "./rng";
import { buildStars } from "./starfield";
import {
  releaseDueGroups,
  releaseEntryGroups,
  runDiveLauncher,
  stepDrones,
} from "./swarm";
import { buildChallengeWave, buildStandardWave } from "./waves";
import type { Art, Bullet, Drone, Screen, SpectraState } from "./types";
import type { Game, InitApi, RenderApi, UpdateApi } from "./runtime";

/** The centre of the ship's lane, where a run and a respawn place it. */
export const LANE_CENTER = (SHIP_X_MIN + SHIP_X_MAX) / 2;

/** The marks the starfield is drawn with, comfortably over the required floor. */
const STARFIELD_COUNT = Math.max(STARFIELD_MIN, 96);

/** What the player is asking of the ship this frame. */
interface Intent {
  /** `-1` left, `1` right, `0` for neither or both. */
  dir: number;
  /** Whether the fire action is held. */
  firing: boolean;
}

/** A fresh state, on the title screen, with nothing on the field. */
export function createState(art: Art): SpectraState {
  const state: SpectraState = {
    art,
    stars: buildStars(STARFIELD_COUNT),
    cues: new Set(),
    screen: "title",
    phase: "live",
    phaseTimer: 0,
    menuIndex: 0,
    score: 0,
    lives: START_LIVES,
    stage: 1,
    extraLifeAwarded: false,
    challengeHits: 0,
    resonance: 0,
    inversion: 0,
    ship: {
      x: LANE_CENTER,
      band: "cyan",
      lockout: 0,
      cooldown: 0,
      contact: true,
    },
    discharge: { active: false, radius: 0, timer: 0 },
    drones: [],
    bullets: [],
    bursts: [],
    waveEntry: true,
    diveLaunching: true,
    entryClock: 0,
    swayClock: 0,
    diveClock: 0,
    diveGap: DIVE_FIRST_DELAY,
    waveRemoved: false,
    simTime: 0,
    muted: false,
    rngState: seedRng(DEFAULT_SEED),
    nextId: 1,
  };
  return state;
}

/**
 * Restore every declared field of the state to its title-screen value, and
 * reseed the game's randomness (specs/instrumentation.md).
 *
 * `muted` is deliberately untouched: muting is a player preference the runtime
 * owns, and a reset is not a reason to start making noise again. The clock is
 * untouched too — whether the game is stepping itself is not a field of the
 * state, and `setAutoStep` is how that is said.
 */
export function resetState(state: SpectraState, seed = DEFAULT_SEED): void {
  state.screen = "title";
  state.phase = "live";
  state.phaseTimer = 0;
  state.menuIndex = 0;
  state.score = 0;
  state.lives = START_LIVES;
  state.stage = 1;
  state.extraLifeAwarded = false;
  state.challengeHits = 0;
  state.resonance = 0;
  state.inversion = 0;
  state.ship.x = LANE_CENTER;
  state.ship.band = "cyan";
  state.ship.lockout = 0;
  state.ship.cooldown = 0;
  state.ship.contact = true;
  state.discharge.active = false;
  state.discharge.radius = 0;
  state.discharge.timer = 0;
  state.drones = [];
  state.bullets = [];
  state.bursts = [];
  state.waveEntry = true;
  state.diveLaunching = true;
  freshWaveClocks(state);
  state.simTime = 0;
  state.rngState = seedRng(seed);
  // The id counter is declared state too, and its title-screen value is the
  // first id. Every roster is empty by now, so no live entity's id is reused —
  // and two seeded replays of the same scenario come out identical down to the
  // ids they report.
  state.nextId = 1;
  state.cues.clear();
}

/** The wave's three clocks, and the gap the next dive waits for, as built. */
function freshWaveClocks(state: SpectraState): void {
  state.entryClock = 0;
  state.swayClock = 0;
  state.diveClock = 0;
  state.diveGap = DIVE_FIRST_DELAY;
  state.waveRemoved = false;
}

/** Return to the title, with the highlight on the first item. */
export function toTitle(state: SpectraState): void {
  state.screen = "title";
  state.phase = "live";
  state.phaseTimer = 0;
  state.menuIndex = 0;
  state.drones = [];
  state.bullets = [];
  state.bursts = [];
  state.discharge.active = false;
  state.discharge.radius = 0;
  state.discharge.timer = 0;
  state.inversion = 0;
}

/** Open a new run: stage 1, `START_LIVES` lives, a score of `0`, on cyan. */
export function startRun(state: SpectraState): void {
  state.score = 0;
  state.lives = START_LIVES;
  state.stage = 1;
  state.resonance = 0;
  state.extraLifeAwarded = false;
  state.ship.band = "cyan";
  // Both of the wave's own faculties are on when a run begins.
  state.waveEntry = true;
  state.diveLaunching = true;
  beginStage(state);
}

/** Open the stage-intro hold for whatever stage the run is on. */
export function beginStage(state: SpectraState): void {
  state.drones = [];
  state.bullets = [];
  state.bursts = [];
  state.inversion = 0;
  state.discharge.active = false;
  state.discharge.radius = 0;
  state.discharge.timer = 0;
  state.ship.x = LANE_CENTER;
  state.ship.lockout = 0;
  state.ship.cooldown = 0;
  freshWaveClocks(state);
  state.screen = "stageIntro";
  state.phase = "live";
  state.phaseTimer = STAGE_INTRO_HOLD;
  state.menuIndex = 0;
}

/**
 * Build the stage's wave and open the live field.
 *
 * The one moment a wave comes into being (specs/stages.md): no drone exists
 * during the stage-intro hold, and the whole roster arrives here, every drone in
 * phase `entering` above `FIELD_TOP`.
 */
export function openWave(state: SpectraState): void {
  freshWaveClocks(state);
  state.challengeHits = 0;
  state.drones = isChallengeStage(state.stage)
    ? buildChallengeWave(state)
    : buildStandardWave(state);
  state.screen = "inWave";
  state.phase = "live";
  state.phaseTimer = 0;
  // The first group is released as the wave opens.
  releaseDueGroups(state);
}

/** The items of whatever vertical menu `screen` shows, or none. */
export function menuItems(screen: Screen): readonly string[] {
  switch (screen) {
    case "title":
      return TITLE_ITEMS;
    case "paused":
      return PAUSE_ITEMS;
    case "gameOver":
      return GAME_OVER_ITEMS;
    default:
      return [];
  }
}

/* -------------------------------------------------------------------------- */
/* Score, resonance, lives                                                    */
/* -------------------------------------------------------------------------- */

/** Add to the score, paying the run's one extra life if this crosses it. */
export function addScore(state: SpectraState, points: number): void {
  state.score += points;
  if (!state.extraLifeAwarded && state.score >= EXTRA_LIFE_AT) {
    state.extraLifeAwarded = true;
    state.lives += 1;
  }
}

/** Add to the resonance meter, which caps at `RESONANCE_MAX`. */
export function addResonance(state: SpectraState, points: number): void {
  state.resonance = Math.min(RESONANCE_MAX, state.resonance + points);
}

/**
 * Lose one life.
 *
 * With lives to spare the live wave enters its `ready` phase and carries on
 * where it was; with none left the run ends. The resonance meter is left exactly
 * where it stands either way.
 */
export function loseLife(state: SpectraState): void {
  state.lives -= 1;
  raise(state, "hit");
  if (state.lives <= 0) {
    state.screen = "gameOver";
    state.phase = "live";
    state.phaseTimer = 0;
    state.menuIndex = 0;
    return;
  }
  state.phase = "ready";
  state.phaseTimer = READY_HOLD;
}

/** What a drone destroyed in its current phase pays. */
export function droneScore(state: SpectraState, drone: Drone): number {
  if (isChallengeStage(state.stage)) return SCORE_CHALLENGE_DRONE;
  const diving = drone.phase !== "formation";
  switch (drone.kind) {
    case "shard":
      return diving ? SCORE_SHARD_DIVE : SCORE_SHARD_FORM;
    case "flux":
      return diving ? SCORE_FLUX_DIVE : SCORE_FLUX_FORM;
    case "prism":
      // Whatever is exposed: the shell if it stands, otherwise the core.
      return drone.shellAlive ? SCORE_PRISM_SHELL : SCORE_PRISM_CORE;
  }
}

/* -------------------------------------------------------------------------- */
/* The discharge                                                              */
/* -------------------------------------------------------------------------- */

/** The discharge action: at full it spends the meter and starts the wave. */
export function releaseDischarge(state: SpectraState): void {
  if (state.resonance < RESONANCE_MAX) return;
  state.resonance = 0;
  state.discharge.active = true;
  state.discharge.radius = 0;
  state.discharge.timer = DISCHARGE_TIME;
  raise(state, "discharge");
}

/* -------------------------------------------------------------------------- */
/* Input                                                                      */
/* -------------------------------------------------------------------------- */

/** The ship's band flip: instant, and it starts a fire lockout. */
export function flipBand(state: SpectraState): void {
  state.ship.band = opposite(state.ship.band);
  // A flip made while a lockout is still standing restarts that lockout.
  state.ship.lockout = FLIP_LOCKOUT;
  raise(state, "flip");
}

/** Move a menu highlight, wrapping at both ends. */
function moveMenu(state: SpectraState, step: number): void {
  const items = menuItems(state.screen);
  if (items.length === 0) return;
  state.menuIndex = (state.menuIndex + items.length + step) % items.length;
  raise(state, "menu");
}

/**
 * Read the frame's keys, act on every edge, and report what is held.
 *
 * Each screen reads only the actions in its own row of `specs/controls.md`, which
 * is what lets `Space` drive `a` on the live field and `confirm` on a menu with
 * no key ever doing two things at once.
 */
function handleInput(state: SpectraState, api: UpdateApi): Intent {
  const intent: Intent = { dir: 0, firing: false };

  // `mute` is read on every screen.
  if (api.input.pressed("mute")) api.audio.toggleMuted();

  switch (state.screen) {
    case "title":
      if (api.input.pressed("up")) moveMenu(state, -1);
      else if (api.input.pressed("down")) moveMenu(state, 1);
      if (api.input.pressed("confirm")) {
        if (state.menuIndex === 0) startRun(state);
        else state.screen = "howto";
      }
      break;

    case "howto":
      if (api.input.pressed("back")) toTitle(state);
      break;

    case "inWave": {
      if (api.input.pressed("pause")) {
        state.screen = "paused";
        state.menuIndex = 0;
        break;
      }
      if (api.input.pressed("b")) flipBand(state);
      if (api.input.pressed("discharge")) releaseDischarge(state);
      // The ship is not on the field during the ready hold.
      if (state.phase === "live") {
        // Holding both directions at once leaves the ship where it stands.
        intent.dir = api.input.value("right") - api.input.value("left");
        intent.firing = api.input.value("a") > 0;
      }
      break;
    }

    case "paused":
      if (api.input.pressed("pause") || api.input.pressed("back")) {
        state.screen = "inWave";
        break;
      }
      if (api.input.pressed("up")) moveMenu(state, -1);
      else if (api.input.pressed("down")) moveMenu(state, 1);
      if (api.input.pressed("confirm")) {
        if (state.menuIndex === 0) state.screen = "inWave";
        else if (state.menuIndex === 1) startRun(state);
        else toTitle(state);
      }
      break;

    case "gameOver":
      if (api.input.pressed("up")) moveMenu(state, -1);
      else if (api.input.pressed("down")) moveMenu(state, 1);
      if (api.input.pressed("confirm")) {
        if (state.menuIndex === 0) startRun(state);
        else toTitle(state);
      }
      break;

    case "stageIntro":
    case "stageCleared":
      // Non-interactive holds: they read `mute` and nothing else.
      break;
  }

  return intent;
}

/* -------------------------------------------------------------------------- */
/* The frame                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * One sub-step of `h` seconds.
 *
 * Everything that moves advances by `v * h`, and then the contacts resolve in
 * the order `specs/simulation.md` fixes. Nothing outside this function moves the
 * game on, which is what makes a second of game time cover the same ground
 * however it was divided into frames.
 */
export function subStep(
  state: SpectraState,
  h: number,
  intent: Intent = { dir: 0, firing: false },
): void {
  state.simTime += h;
  // A paused game is exactly where it was when it was paused.
  if (state.screen === "paused") return;

  advanceTimers(state, h);
  stepBursts(state, h);

  if (state.screen === "inWave") {
    if (state.phase === "live") stepShip(state, h, intent);
    state.swayClock += h;
    releaseEntryGroups(state, h);
    stepDrones(state, h);
    stepBullets(state, h);
    stepDischargeWave(state, h);
    runDiveLauncher(state, h);
    resolveContacts(state);
    resolveRemovals(state);
  }

  advanceScreenHold(state, h);
}

/** The clocks that run wherever the game is, short of being paused. */
function advanceTimers(state: SpectraState, h: number): void {
  const ship = state.ship;
  if (ship.lockout > 0) ship.lockout = Math.max(0, ship.lockout - h);
  if (ship.cooldown > 0) ship.cooldown = Math.max(0, ship.cooldown - h);
  if (state.inversion > 0) state.inversion = Math.max(0, state.inversion - h);
}

/** The hold the current screen or phase is running, and what its end opens. */
function advanceScreenHold(state: SpectraState, h: number): void {
  switch (state.screen) {
    case "stageIntro":
      state.phaseTimer -= h;
      if (state.phaseTimer <= 0) openWave(state);
      break;
    case "stageCleared":
      state.phaseTimer -= h;
      if (state.phaseTimer <= 0) {
        state.stage += 1;
        beginStage(state);
      }
      break;
    case "inWave":
      if (state.phase !== "ready") break;
      state.phaseTimer -= h;
      if (state.phaseTimer <= 0) {
        state.phase = "live";
        state.phaseTimer = 0;
        state.ship.x = LANE_CENTER;
      }
      break;
    default:
      break;
  }
}

/** The ship along its lane, and the cannon. */
function stepShip(state: SpectraState, h: number, intent: Intent): void {
  const ship = state.ship;
  ship.x = Math.min(
    SHIP_X_MAX,
    Math.max(SHIP_X_MIN, ship.x + intent.dir * SHIP_SPEED * h),
  );
  if (!intent.firing) return;
  if (ship.cooldown > 0 || ship.lockout > 0) return;
  const inFlight = state.bullets.filter(
    (bullet) => bullet.friendly && !bullet.dead,
  ).length;
  if (inFlight >= MAX_PLAYER_BULLETS) return;
  addPlayerBullet(state, ship.x, SHIP_Y - SHIP_H / 2, ship.band);
  ship.cooldown = FIRE_INTERVAL;
  raise(state, "fire");
}

/** One of the player's bullets, travelling straight up, carrying `band`. */
export function addPlayerBullet(
  state: SpectraState,
  x: number,
  y: number,
  band: Band,
): Bullet {
  const bullet: Bullet = {
    id: state.nextId++,
    x,
    y,
    vx: 0,
    vy: -PLAYER_BULLET_SPEED,
    band,
    friendly: true,
    dead: false,
  };
  state.bullets.push(bullet);
  return bullet;
}

/** Every bullet by `v * h`, and the ones that have left the play field. */
function stepBullets(state: SpectraState, h: number): void {
  for (const bullet of state.bullets) {
    if (bullet.dead) continue;
    bullet.x += bullet.vx * h;
    bullet.y += bullet.vy * h;
    if (bullet.friendly ? bullet.y < FIELD_TOP : bullet.y > FIELD_BOTTOM) {
      bullet.dead = true;
    }
  }
}

/** The live discharge wave's radius over its life. */
function stepDischargeWave(state: SpectraState, h: number): void {
  const wave = state.discharge;
  if (!wave.active) return;
  wave.timer -= h;
  const elapsed = Math.min(DISCHARGE_TIME, DISCHARGE_TIME - wave.timer);
  wave.radius = (elapsed / DISCHARGE_TIME) * DISCHARGE_MAX_R;
  if (wave.timer <= 0) {
    wave.active = false;
    wave.radius = 0;
    wave.timer = 0;
  }
}

/* -------------------------------------------------------------------------- */
/* The contacts                                                               */
/* -------------------------------------------------------------------------- */

/**
 * The contacts of one sub-step, in the order `specs/simulation.md` fixes.
 *
 * One event costs exactly one life, whatever else is on the field at that
 * instant, so a bullet that gets through stops the body test for this sub-step.
 */
function resolveContacts(state: SpectraState): void {
  resolvePlayerBullets(state);
  if (state.ship.contact && state.phase === "live") {
    if (!resolveEnemyBullets(state)) resolveDroneBodies(state);
  }
  resolveDischarge(state);
}

/** 1. Each of the player's bullets against every drone, nearest drone first. */
function resolvePlayerBullets(state: SpectraState): void {
  for (const bullet of state.bullets) {
    if (!bullet.friendly || bullet.dead) continue;
    let nearest: Drone | null = null;
    let nearestDistance = Infinity;
    for (const drone of state.drones) {
      if (drone.dead) continue;
      if (
        !overlaps(
          bullet.x,
          bullet.y,
          PLAYER_BULLET_HALF,
          drone.x,
          drone.y,
          droneHalf(drone),
        )
      ) {
        continue;
      }
      const distance = Math.hypot(bullet.x - drone.x, bullet.y - drone.y);
      if (distance < nearestDistance) {
        nearest = drone;
        nearestDistance = distance;
      }
    }
    if (nearest === null) continue;
    // Any contact consumes the shot, whether it destroys or is wasted.
    bullet.dead = true;
    hitDrone(state, nearest, effectiveBulletBand(state, bullet));
  }
}

/**
 * A player bullet of effective band `band` strikes `drone`.
 *
 * The two effective bands decide the outcome and nothing else does. Under Sortie
 * a mismatched shot leaves the drone exactly as it was: its phase, its position,
 * its slot, its stored band, its band clock, its shell and its course all
 * unchanged (specs/mode.md).
 */
export function hitDrone(state: SpectraState, drone: Drone, band: Band): void {
  // No shot destroys a shimmering Flux, of either band.
  if (drone.kind === "flux" && isShimmering(state, drone)) return;
  if (effectiveDroneBand(state, drone) !== band) return;

  if (drone.kind === "prism" && drone.shellAlive) {
    // The shell falls and the core is exposed; the Prism lives on.
    addScore(state, SCORE_PRISM_SHELL);
    drone.popAt = droneFootprint(drone);
    drone.shellAlive = false;
    raise(state, "kill");
    return;
  }

  addScore(state, droneScore(state, drone));
  addResonance(state, RESONANCE_KILL);
  if (isChallengeStage(state.stage)) state.challengeHits += 1;
  drone.popAt = droneFootprint(drone);
  drone.dead = true;
  raise(state, "kill");
}

/** 2. Each enemy bullet against the ship. Returns whether a life was lost. */
function resolveEnemyBullets(state: SpectraState): boolean {
  for (const bullet of state.bullets) {
    if (bullet.friendly || bullet.dead) continue;
    if (
      !overlaps(
        bullet.x,
        bullet.y,
        ENEMY_BULLET_HALF,
        state.ship.x,
        SHIP_Y,
        SHIP_HALF,
      )
    ) {
      continue;
    }
    bullet.dead = true;
    if (effectiveBulletBand(state, bullet) === state.ship.band) {
      // The hull absorbs its own band, and the meter takes it.
      addResonance(state, RESONANCE_ABSORB);
      raise(state, "absorb");
      continue;
    }
    loseLife(state);
    return true;
  }
  return false;
}

/** 3. Each drone's body against the ship. Returns whether a life was lost. */
function resolveDroneBodies(state: SpectraState): boolean {
  // A challenge drone's body costs no life: contact does nothing.
  if (isChallengeStage(state.stage)) return false;
  for (const drone of state.drones) {
    if (drone.dead) continue;
    if (
      !overlaps(
        drone.x,
        drone.y,
        droneHalf(drone),
        state.ship.x,
        SHIP_Y,
        SHIP_HALF,
      )
    ) {
      continue;
    }
    loseLife(state);
    return true;
  }
  return false;
}

/** 4. The live discharge wave against what it has reached. */
function resolveDischarge(state: SpectraState): void {
  const wave = state.discharge;
  if (!wave.active) return;
  for (const drone of state.drones) {
    if (drone.dead || drone.phase === "formation") continue;
    if (!reached(state, drone.x, drone.y)) continue;
    destroyByWave(state, drone);
  }
  for (const bullet of state.bullets) {
    if (bullet.friendly || bullet.dead) continue;
    if (!reached(state, bullet.x, bullet.y)) continue;
    bullet.dead = true;
  }
}

/** Whether the wave's current radius has reached a centre. */
function reached(state: SpectraState, x: number, y: number): boolean {
  return Math.hypot(x - state.ship.x, y - SHIP_Y) <= state.discharge.radius;
}

/**
 * The wave destroys a drone: band-blind, and a Prism whole, shell and core
 * together in one step.
 *
 * It pays what a bullet in that phase pays and fills no resonance, because only
 * one of the player's bullets does that (specs/resonance.md).
 */
function destroyByWave(state: SpectraState, drone: Drone): void {
  if (isChallengeStage(state.stage)) {
    addScore(state, SCORE_CHALLENGE_DRONE);
    state.challengeHits += 1;
  } else if (drone.kind === "prism") {
    if (drone.shellAlive) addScore(state, SCORE_PRISM_SHELL);
    addScore(state, SCORE_PRISM_CORE);
  } else {
    addScore(state, droneScore(state, drone));
  }
  drone.popAt = droneFootprint(drone);
  drone.dead = true;
}

/** 5. Removals, the bursts every destroyed drone starts, and the stage's end. */
function resolveRemovals(state: SpectraState): void {
  for (const drone of state.drones) {
    if (drone.popAt <= 0) continue;
    startBurst(state, drone.x, drone.y, drone.popAt);
    drone.popAt = 0;
  }
  const before = state.drones.length;
  state.drones = state.drones.filter((drone) => !drone.dead);
  state.bullets = state.bullets.filter((bullet) => !bullet.dead);
  if (state.drones.length === before) return;

  state.waveRemoved = true;
  // A stage clears on the transition, not on a predicate: the roster emptying
  // through a removal is what clears it, so a live wave that was never given a
  // drone is being played rather than cleared (specs/stages.md).
  if (state.screen === "inWave" && state.drones.length === 0) clearStage(state);
}

/** The interstitial a finished stage opens, and the bonus it pays. */
export function clearStage(state: SpectraState): void {
  if (isChallengeStage(state.stage)) {
    if (state.challengeHits >= CHALLENGE_TOTAL) {
      addScore(state, SCORE_PERFECT_BONUS);
    }
  } else {
    addScore(state, SCORE_STAGE_CLEAR);
  }
  raise(state, "stage-clear");
  state.screen = "stageCleared";
  state.phase = "live";
  state.phaseTimer = STAGE_CLEARED_HOLD;
}

/* -------------------------------------------------------------------------- */
/* The game the runtime drives                                                */
/* -------------------------------------------------------------------------- */

/** Every cue the frame raised, played once each, then cleared. */
function flushCues(state: SpectraState, api: UpdateApi): void {
  if (state.cues.size === 0) return;
  for (const cue of state.cues) api.audio.play(cue);
  state.cues.clear();
}

/** Spectra, as the runtime's `Game<S>` contract. */
export function createSpectra(art: Art): Game<SpectraState> {
  return {
    initialize(api: InitApi): SpectraState {
      for (const action of ACTIONS) {
        api.input.register(action, BINDINGS[action]);
      }
      for (const [cue, spec] of Object.entries(CUE_SPECS)) {
        api.audio.define(cue, spec);
      }
      const state = createState(art);
      registerDiagnostics(api, state);
      return state;
    },

    update(state: SpectraState, api: UpdateApi, dt: number): void {
      state.muted = api.audio.muted();
      const intent = handleInput(state, api);
      // Read again: the frame's `mute` press has landed by now.
      state.muted = api.audio.muted();
      const steps = Math.max(1, Math.ceil(dt / SUBSTEP_MAX));
      const h = dt / steps;
      for (let i = 0; i < steps; i += 1) subStep(state, h, intent);
      flushCues(state, api);
    },

    render(state: SpectraState, api: RenderApi): void {
      renderSpectra(state, api.ctx);
    },
  };
}
