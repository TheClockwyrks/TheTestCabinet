// Spectra — the debugging and automation surface, `window.__spectra`.
//
// `specs/instrumentation.md` specifies it and this file implements it. It is
// installed by `src/main.ts` as soon as the game has initialized, and it is inert
// during normal play: nothing below runs until something calls it.
//
// EVERY OPERATION IS A READ, A POSE OF ONE FIELD, OR A MOVE OF THE CLOCK. A pose
// ARRANGES THE WORLD and never fabricates an outcome: it puts the game into a
// situation, and the game's own stepping, contact, band, scoring and stage rules
// run from there exactly as they do in play. That is why there is no `flip`, no
// `fire` and no `discharge` here — each of those is an outcome, reached by driving
// the real action and reading the result back.
//
// THE TWO EXCEPTIONS ARE THE CLOCK. `setAutoStep` and `advance` reach past the
// state into the runtime, because this build stands on no engine and nothing
// outside it owns its clock. Without them a scenario could only be driven by
// waiting, and a check that waits measures the machine it ran on. The keyboard
// and the overlay stay absent: both belong to the runtime layer, which reports
// which keys are down and owns the backtick key.

import {
  DEFAULT_SEED,
  ENEMY_BULLET_SPEED,
  RESONANCE_MAX,
  SHIP_X_MAX,
  SHIP_X_MIN,
  SPECTRA_DEBUG_VERSION,
  bulletSpeedScale,
  diveGapScale,
  droneSpeedScale,
  fluxHold,
  isChallengeStage,
  type Band,
} from "./constants";
import {
  dischargeReady,
  effectiveBulletBand,
  effectiveDroneBand,
  inversionActive,
  isShimmering,
} from "./bands";
import { addPlayerBullet, resetState } from "./game";
import { enterPhase, spawnEnemyBullet } from "./swarm";
import type {
  Drone,
  DroneKind,
  DronePhase,
  Phase,
  Screen,
  SpectraState,
} from "./types";

/** The `window` property the surface is installed on. */
export const SPECTRA_HANDLE = "__spectra";

/**
 * The runtime's clock, as the surface reaches it.
 *
 * Structural on purpose: `src/runtime.ts` satisfies it without knowing this file
 * exists, and a test can hand the surface a clock of its own.
 */
export interface DebugClock {
  /** Take the game off the wall clock, or give it back. */
  setAutoStep(enabled: boolean): void;
  /** Run `frames` whole frames covering `seconds` of game time. */
  advance(seconds: number, frames?: number): void;
}

/** One drone, as `snapshot` reports it. */
export interface DroneSnapshot {
  id: number;
  kind: DroneKind;
  x: number;
  y: number;
  band: Band;
  effectiveBand: Band;
  phase: DronePhase;
  slotX: number;
  slotY: number;
  bandClock: number;
  shimmer: boolean;
  shellAlive: boolean;
  travel: boolean;
  oscillation: boolean;
  fire: boolean;
}

/** One bullet, as `snapshot` reports it. */
export interface BulletSnapshot {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  band: Band;
  effectiveBand: Band;
  friendly: boolean;
}

/** One drone-burst, as `snapshot` reports it. */
export interface BurstSnapshot {
  id: number;
  x: number;
  y: number;
  size: number;
  elapsed: number;
  particles: number;
}

/** The plain, JSON-serializable view `snapshot()` returns. */
export interface SpectraSnapshot {
  version: number;
  screen: Screen;
  phase: Phase;
  phaseTimer: number;
  menuIndex: number;
  mode: "sortie";
  stage: number;
  isChallenge: boolean;
  score: number;
  lives: number;
  extraLifeAwarded: boolean;
  resonance: number;
  dischargeReady: boolean;
  inversion: number;
  inversionActive: boolean;
  muted: boolean;
  waveEntry: boolean;
  diveLaunching: boolean;
  diveClock: number;
  droneSpeedScale: number;
  bulletSpeedScale: number;
  diveGapScale: number;
  fluxHold: number;
  ship: {
    x: number;
    band: Band;
    alive: boolean;
    lockout: number;
    cooldown: number;
    contact: boolean;
  };
  discharge: { active: boolean; radius: number };
  drones: DroneSnapshot[];
  bullets: BulletSnapshot[];
  bursts: BurstSnapshot[];
  simTime: number;
}

/** Every operation `specs/instrumentation.md` specifies. */
export interface SpectraDebugApi {
  version: number;

  reset(options?: { seed?: number }): void;
  snapshot(): SpectraSnapshot;

  setAutoStep(enabled: boolean): void;
  advance(seconds: number, frames?: number): void;

  setScreen(screen: Screen): void;
  setPhase(phase: Phase): void;
  setPhaseTimer(seconds: number): void;
  setMenuIndex(index: number): void;
  setScore(score: number): void;
  setLives(lives: number): void;
  setStage(stage: number): void;
  setExtraLifeAwarded(awarded: boolean): void;

  setWaveEntry(enabled: boolean): void;
  setDiveLaunching(enabled: boolean): void;
  setShipContact(enabled: boolean): void;
  setDiveClock(seconds: number): void;

  setShipX(x: number): void;
  setShipBand(band: Band): void;
  setFireLockout(seconds: number): void;
  setFireCooldown(seconds: number): void;

  setResonance(value: number): void;
  setInversion(seconds: number): void;

  addDrone(kind: DroneKind, x: number, y: number): number;
  setDronePosition(id: number, x: number, y: number): void;
  setDroneBand(id: number, band: Band): void;
  setDronePhase(id: number, phase: DronePhase): void;
  setDroneSlot(id: number, x: number, y: number): void;
  setDroneBandClock(id: number, seconds: number): void;
  setDroneShell(id: number, intact: boolean): void;
  setDroneTravel(id: number, enabled: boolean): void;
  setDroneOscillation(id: number, enabled: boolean): void;
  setDroneFire(id: number, enabled: boolean): void;
  removeDrone(id: number): void;
  clearDrones(): void;

  addPlayerBullet(x: number, y: number, band: Band): number;
  addEnemyBullet(x: number, y: number, band: Band): number;
  setBulletVelocity(id: number, vx: number, vy: number): void;
  removeBullet(id: number): void;
  clearPlayerBullets(): void;
  clearEnemyBullets(): void;

  removeBurst(id: number): void;
  clearBursts(): void;
}

/** A finite number, or the fallback where the caller handed something else. */
function finite(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback;
}

/** A finite, non-negative number of seconds. */
function seconds(value: number): number {
  return Math.max(0, finite(value));
}

/** One of the two bands; anything else is a caller error. */
function band(value: Band): Band {
  if (value !== "cyan" && value !== "magenta") {
    throw new RangeError(`Spectra: "${String(value)}" is not a band`);
  }
  return value;
}

/** Build the surface over one live state object and the runtime driving it. */
export function createDebugApi(
  state: SpectraState,
  clock: DebugClock,
): SpectraDebugApi {
  /** The drone with that id, or a caller error naming the id. */
  function drone(id: number): Drone {
    const found = state.drones.find((candidate) => candidate.id === id);
    if (found === undefined) {
      throw new RangeError(`Spectra: no drone with id ${id}`);
    }
    return found;
  }

  return {
    version: SPECTRA_DEBUG_VERSION,

    /* ---- The core ------------------------------------------------------- */

    /**
     * Restore every declared field of the state to its title-screen value, and
     * reseed the game's randomness.
     *
     * `muted` is left exactly as it stands, because muting is a player
     * preference the runtime owns. The clock is untouched too: whether the game
     * is stepping itself is not a field of the state.
     */
    reset(options) {
      resetState(state, options?.seed ?? DEFAULT_SEED);
    },

    /** A pure read of the state. It changes nothing. */
    snapshot() {
      return {
        version: SPECTRA_DEBUG_VERSION,
        screen: state.screen,
        phase: state.phase,
        phaseTimer: state.phaseTimer,
        menuIndex: state.menuIndex,
        mode: "sortie",
        stage: state.stage,
        isChallenge: isChallengeStage(state.stage),
        score: state.score,
        lives: state.lives,
        extraLifeAwarded: state.extraLifeAwarded,
        resonance: state.resonance,
        dischargeReady: dischargeReady(state),
        inversion: state.inversion,
        inversionActive: inversionActive(state),
        muted: state.muted,
        waveEntry: state.waveEntry,
        diveLaunching: state.diveLaunching,
        diveClock: state.diveClock,
        droneSpeedScale: droneSpeedScale(state.stage),
        bulletSpeedScale: bulletSpeedScale(state.stage),
        diveGapScale: diveGapScale(state.stage),
        fluxHold: fluxHold(state.stage),
        ship: {
          x: state.ship.x,
          band: state.ship.band,
          // Derived: false exactly while the phase is `ready`.
          alive: state.phase !== "ready",
          lockout: state.ship.lockout,
          cooldown: state.ship.cooldown,
          contact: state.ship.contact,
        },
        discharge: {
          active: state.discharge.active,
          radius: state.discharge.radius,
        },
        drones: state.drones.map((entry) => ({
          id: entry.id,
          kind: entry.kind,
          x: entry.x,
          y: entry.y,
          band: entry.band,
          effectiveBand: effectiveDroneBand(state, entry),
          phase: entry.phase,
          slotX: entry.slotX,
          slotY: entry.slotY,
          bandClock: entry.kind === "flux" ? entry.bandClock : 0,
          shimmer: isShimmering(state, entry),
          shellAlive: entry.kind === "prism" ? entry.shellAlive : true,
          travel: entry.travel,
          oscillation: entry.oscillation,
          fire: entry.fire,
        })),
        bullets: state.bullets.map((entry) => ({
          id: entry.id,
          x: entry.x,
          y: entry.y,
          vx: entry.vx,
          vy: entry.vy,
          band: entry.band,
          effectiveBand: effectiveBulletBand(state, entry),
          friendly: entry.friendly,
        })),
        bursts: state.bursts.map((entry) => ({
          id: entry.id,
          x: entry.x,
          y: entry.y,
          size: entry.size,
          elapsed: entry.elapsed,
          particles: entry.sim.liveCount,
        })),
        simTime: state.simTime,
      };
    },

    /* ---- The clock ------------------------------------------------------ */

    /**
     * Take the game off real time, and give it back.
     *
     * `false` stops the frame loop advancing the simulation from the wall clock,
     * so the game changes only when `advance` says so; `true` returns it to
     * running itself, which is how a build starts and how it is played. Drawing
     * is unaffected either way, and it changes no game state.
     */
    setAutoStep(enabled) {
      clock.setAutoStep(Boolean(enabled));
    },

    /**
     * Run `frames` whole frames covering `seconds` of game time, each worth
     * `seconds / frames`, immediately and in order.
     *
     * Each is a real frame — the same update the loop runs, then a render — so
     * the game's own rules produce the result and the canvas reflects it. Every
     * rate is integrated against the frame's delta and a frame divides into
     * whole sub-steps of at most `SUBSTEP_MAX`, so `advance(1, 1)` and
     * `advance(1, 60)` cover the same second and reach the same state.
     *
     * Advancing while the game is still stepping itself ADDS to what the wall
     * clock is already doing, so call `setAutoStep(false)` first.
     */
    advance(count, frames = 1) {
      clock.advance(count, frames);
    },

    /* ---- The screen and the run ----------------------------------------- */

    setScreen(screen) {
      state.screen = screen;
    },

    setPhase(phase) {
      state.phase = phase;
    },

    setPhaseTimer(value) {
      state.phaseTimer = finite(value);
    },

    setMenuIndex(index) {
      state.menuIndex = Math.max(0, Math.floor(finite(index)));
    },

    /**
     * Set the score as a precondition.
     *
     * It grants no extra life, whatever boundary it carries the score across:
     * the award belongs to the scoring path. It leaves `extraLifeAwarded`
     * exactly as it stands too, so posing the score down and back up does not
     * re-arm the award.
     */
    setScore(score) {
      state.score = finite(score);
    },

    setLives(lives) {
      state.lives = Math.floor(finite(lives));
    },

    /**
     * Set the stage.
     *
     * It spawns nothing and clears nothing. The stage's four derived figures and
     * `isChallenge` all follow it, since each is derived from the stage.
     */
    setStage(stage) {
      state.stage = Math.max(1, Math.floor(finite(stage, 1)));
    },

    setExtraLifeAwarded(awarded) {
      state.extraLifeAwarded = Boolean(awarded);
    },

    /* ---- The world gates and the dive clock ------------------------------ */

    setWaveEntry(enabled) {
      state.waveEntry = Boolean(enabled);
    },

    setDiveLaunching(enabled) {
      state.diveLaunching = Boolean(enabled);
    },

    setShipContact(enabled) {
      state.ship.contact = Boolean(enabled);
    },

    /** The seconds the wave's dive timer has accumulated. It launches nothing. */
    setDiveClock(value) {
      state.diveClock = seconds(value);
    },

    /* ---- The ship and its cannon ---------------------------------------- */

    /** Place the ship along its lane; the lane's clamp applies. */
    setShipX(x) {
      state.ship.x = Math.min(SHIP_X_MAX, Math.max(SHIP_X_MIN, finite(x)));
    },

    /** The band the ship holds. It starts no fire lockout. */
    setShipBand(value) {
      state.ship.band = band(value);
    },

    setFireLockout(value) {
      state.ship.lockout = seconds(value);
    },

    setFireCooldown(value) {
      state.ship.cooldown = seconds(value);
    },

    /* ---- Resonance and the inversion ------------------------------------ */

    setResonance(value) {
      state.resonance = Math.min(RESONANCE_MAX, Math.max(0, finite(value)));
    },

    setInversion(value) {
      state.inversion = seconds(value);
    },

    /* ---- The drones ----------------------------------------------------- */

    /**
     * Add one drone of `kind` at a logical stage position.
     *
     * It is appended to the roster and takes a fresh id, which is read from the
     * last entry. Its band is cyan, its phase `formation`, its slot the position
     * it was placed at, its band clock `0`, its shell intact, and all three of
     * its faculties on.
     */
    addDrone(kind, x, y) {
      const placedX = finite(x);
      const placedY = finite(y);
      const added: Drone = {
        id: state.nextId++,
        kind,
        x: placedX,
        y: placedY,
        band: "cyan",
        phase: "formation",
        phaseSeconds: 0,
        slotX: placedX,
        slotY: placedY,
        entryGroup: 0,
        released: true,
        bandClock: 0,
        shellAlive: true,
        shots: 0,
        firePending: false,
        travel: true,
        oscillation: true,
        fire: true,
        path: null,
        pathDist: 0,
        dead: false,
        popAt: 0,
      };
      state.drones.push(added);
      return added.id;
    },

    setDronePosition(id, x, y) {
      const target = drone(id);
      target.x = finite(x);
      target.y = finite(y);
    },

    /**
     * The drone's stored band, on every kind.
     *
     * It moves the band and nothing else: `bandClock` stays exactly where it
     * stands, because the two are independent fields with one setter each.
     */
    setDroneBand(id, value) {
      drone(id).band = band(value);
    },

    /** The phase, with the phase's own path code running from there. */
    setDronePhase(id, phase) {
      enterPhase(state, drone(id), phase);
    },

    setDroneSlot(id, x, y) {
      const target = drone(id);
      target.slotX = finite(x);
      target.slotY = finite(y);
    },

    /**
     * How far a Flux is into its current band window.
     *
     * It moves the clock and nothing else: `shimmer` follows it, and `band` does
     * not change.
     */
    setDroneBandClock(id, value) {
      drone(id).bandClock = seconds(value);
    },

    setDroneShell(id, intact) {
      drone(id).shellAlive = Boolean(intact);
    },

    /**
     * The drone's locomotion alone.
     *
     * Off, it holds its exact centre and keeps its phase; nothing is cancelled,
     * completed, or resolved early. Its band clock and its firing run on.
     */
    setDroneTravel(id, enabled) {
      drone(id).travel = Boolean(enabled);
    },

    /**
     * A Flux's band clock alone.
     *
     * Off, the Flux holds whichever band or shimmer it is in indefinitely. Every
     * drone accepts the gate; on a Shard or a Prism it gates nothing.
     */
    setDroneOscillation(id, enabled) {
      drone(id).oscillation = Boolean(enabled);
    },

    /** The drone's firing alone. Off, it flies its whole dive silent. */
    setDroneFire(id, enabled) {
      drone(id).fire = Boolean(enabled);
    },

    removeDrone(id) {
      state.drones = state.drones.filter((entry) => entry.id !== id);
    },

    /** Every drone, leaving the bullets and the bursts standing. */
    clearDrones() {
      state.drones = [];
    },

    /* ---- The bullets ---------------------------------------------------- */

    /** One of the player's bullets, travelling straight up at its own speed. */
    addPlayerBullet(x, y, value) {
      return addPlayerBullet(state, finite(x), finite(y), band(value)).id;
    },

    /** One enemy bullet, travelling straight down, scaled for the stage. */
    addEnemyBullet(x, y, value) {
      return spawnEnemyBullet(
        state,
        finite(x),
        finite(y),
        band(value),
        ENEMY_BULLET_SPEED * bulletSpeedScale(state.stage),
      ).id;
    },

    setBulletVelocity(id, vx, vy) {
      const found = state.bullets.find((entry) => entry.id === id);
      if (found === undefined) {
        throw new RangeError(`Spectra: no bullet with id ${id}`);
      }
      found.vx = finite(vx);
      found.vy = finite(vy);
    },

    removeBullet(id) {
      state.bullets = state.bullets.filter((entry) => entry.id !== id);
    },

    /** Every one of the player's bullets, leaving the enemy bullets standing. */
    clearPlayerBullets() {
      state.bullets = state.bullets.filter((entry) => !entry.friendly);
    },

    /** Every enemy bullet, leaving the player's bullets standing. */
    clearEnemyBullets() {
      state.bullets = state.bullets.filter((entry) => entry.friendly);
    },

    /* ---- The bursts ----------------------------------------------------- */

    removeBurst(id) {
      state.bursts = state.bursts.filter((entry) => entry.id !== id);
    },

    /** Every live drone-burst, leaving the drones and the bullets standing. */
    clearBursts() {
      state.bursts = [];
    },
  };
}

/**
 * Install the surface on `window.__spectra` and return the function that removes
 * it again, while the installed object is still the one this call published.
 */
export function installDebugApi(
  state: SpectraState,
  clock: DebugClock,
): () => void {
  const api = createDebugApi(state, clock);
  const target = window as unknown as Record<string, unknown>;
  target[SPECTRA_HANDLE] = api;
  return () => {
    if (target[SPECTRA_HANDLE] === api) delete target[SPECTRA_HANDLE];
  };
}
