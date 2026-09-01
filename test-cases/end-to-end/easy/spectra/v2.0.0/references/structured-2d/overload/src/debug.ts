// Spectra — the debugging and automation surface (specs/instrumentation.md).
//
// `createDebugApi` builds it, the game instance's `initialize` returns it, and the
// engine holds that same object and hands it back from `engine.debug` — the one
// way a caller reaches it. Nothing is installed on the page.
//
// Every operation acts on the LIVE game at the moment it is called, reaching the
// open world through the accessor the instance supplies, and takes only the
// parameters its own row names. A POSE arranges the running game and returns
// nothing; a READING returns plain data built at the call and changes nothing.
//
// EACH POSE SETS ONE FIELD. There is no operation that takes a layout, a patch or
// a bag of options: a drone is built one field at a time, a bullet is placed and
// then steered, and each faculty is its own switch. That is what makes every pose
// verifiable by setting a value and reading it back through `snapshot`, and it is
// why the snapshot reports every field a pose can set.
//
// THE THREE WORLD GATES are worth naming: `setWaveEntry`, `setDiveLaunching` and
// `setShipContact` each hold ONE faculty of the wave itself, default to on, are
// restored to on by `reset`, and are reported by `snapshot`. With the three of them
// off, nothing the caller did not ask for arrives, launches, or costs a life.
//
// The surface holds no state and is inert during normal play: nothing below runs
// until something calls it.

import type { World } from "@test-cabinet/structured-2d";
import {
  DEFAULT_SEED,
  RESONANCE_MAX,
  SPECTRA_DEBUG_VERSION,
  bulletSpeedScale,
  diveGapScale,
  droneSpeedScale,
  fluxHold,
  isChallengeStage,
} from "./constants";
import {
  bulletEffectiveBand,
  droneEffectiveBand,
  fluxWindowAt,
  shimmering,
} from "./bands";
import {
  addEnemyBulletTo,
  addPlayerBulletTo,
  removeBullet as dropBullet,
} from "./bullets";
import { removeBurst as dropBurst } from "./bursts";
import {
  addDroneTo,
  droneById,
  removeDrone as dropDrone,
  setDronePhase,
} from "./drones";
import { resetState } from "./flow";
import { clampCharge } from "./overload";
import { placeShip } from "./ship";
import {
  spectraState,
  type Band,
  type DroneKind,
  type DronePhase,
  type DroneState,
  type Phase,
  type Screen,
  type SpectraState,
} from "./game";

// ---- The snapshot shape (specs/instrumentation.md) -----------------------

export interface SnapshotShip {
  x: number;
  band: Band;
  alive: boolean;
  lockout: number;
  cooldown: number;
  contact: boolean;
}

export interface SnapshotDischarge {
  active: boolean;
  radius: number;
}

export interface SnapshotDrone {
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
  charge: number;
}

export interface SnapshotBullet {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  band: Band;
  effectiveBand: Band;
  friendly: boolean;
}

export interface SnapshotBurst {
  id: number;
  x: number;
  y: number;
  size: number;
  elapsed: number;
  particles: number;
}

export interface SpectraSnapshot {
  version: number;
  screen: Screen;
  phase: Phase;
  phaseTimer: number;
  menuIndex: number;
  mode: "overload";
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
  ship: SnapshotShip;
  discharge: SnapshotDischarge;
  drones: SnapshotDrone[];
  bullets: SnapshotBullet[];
  bursts: SnapshotBurst[];
  simTime: number;
}

// ---- The surface --------------------------------------------------------

/**
 * The surface. Every pose acts on the live game at the call and returns nothing;
 * the one reading, `snapshot`, returns what it read.
 */
export interface SpectraDebugApi {
  version: number;

  reset(options?: { seed?: number }): void;
  snapshot(): SpectraSnapshot;

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

  addDrone(kind: DroneKind, x: number, y: number): void;
  setDronePosition(id: number, x: number, y: number): void;
  setDroneBand(id: number, band: Band): void;
  setDronePhase(id: number, phase: DronePhase): void;
  setDroneSlot(id: number, x: number, y: number): void;
  setDroneBandClock(id: number, seconds: number): void;
  setDroneShell(id: number, intact: boolean): void;
  setDroneCharge(id: number, charge: number): void;
  setDroneTravel(id: number, enabled: boolean): void;
  setDroneOscillation(id: number, enabled: boolean): void;
  setDroneFire(id: number, enabled: boolean): void;
  removeDrone(id: number): void;
  clearDrones(): void;

  addPlayerBullet(x: number, y: number, band: Band): void;
  addEnemyBullet(x: number, y: number, band: Band): void;
  setBulletVelocity(id: number, vx: number, vy: number): void;
  removeBullet(id: number): void;
  clearPlayerBullets(): void;
  clearEnemyBullets(): void;

  removeBurst(id: number): void;
  clearBursts(): void;
}

/** A drone snapshot, with the two derived readings built at the call. */
function readDrone(state: SpectraState, drone: DroneState): SnapshotDrone {
  return {
    id: drone.id,
    kind: drone.kind,
    x: drone.x,
    y: drone.y,
    band: drone.band,
    effectiveBand: droneEffectiveBand(drone, state),
    phase: drone.phase,
    slotX: drone.slotX,
    slotY: drone.slotY,
    bandClock: drone.kind === "flux" ? drone.bandClock : 0,
    shimmer: shimmering(drone, state.stage),
    shellAlive: drone.kind === "prism" ? drone.shellAlive : true,
    travel: drone.travel,
    oscillation: drone.oscillation,
    fire: drone.fire,
    charge: drone.charge,
  };
}

/**
 * Build the surface over an accessor for the open world. It holds nothing: every
 * operation reads the world — and the state it carries — at the moment it is
 * called, so the surface follows the live game for the life of the engine.
 */
export function createDebugApi(world: () => World): SpectraDebugApi {
  const read = (): SpectraState => spectraState(world());
  const drone = (id: number): DroneState | undefined => droneById(read(), id);
  const atLeast = (value: number, floor = 0): number => Math.max(floor, value);

  return {
    version: SPECTRA_DEBUG_VERSION,

    reset(options) {
      resetState(read(), options?.seed ?? DEFAULT_SEED);
    },

    snapshot() {
      const state = read();
      return {
        version: SPECTRA_DEBUG_VERSION,
        screen: state.screen,
        phase: state.phase,
        phaseTimer: state.phaseTimer,
        menuIndex: state.menuIndex,
        mode: "overload",
        stage: state.stage,
        isChallenge: isChallengeStage(state.stage),
        score: state.score,
        lives: state.lives,
        extraLifeAwarded: state.extraLifeAwarded,
        resonance: state.resonance,
        dischargeReady: state.resonance >= RESONANCE_MAX,
        inversion: state.inversion,
        inversionActive: state.inversion > 0,
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
          alive: state.phase !== "ready",
          lockout: state.ship.lockout,
          cooldown: state.ship.cooldown,
          contact: state.ship.contact,
        },
        discharge: {
          active: state.discharge.active,
          radius: state.discharge.radius,
        },
        drones: state.drones.map((entry) => readDrone(state, entry)),
        bullets: state.bullets.map((bullet) => ({
          id: bullet.id,
          x: bullet.x,
          y: bullet.y,
          vx: bullet.vx,
          vy: bullet.vy,
          band: bullet.band,
          effectiveBand: bulletEffectiveBand(bullet, state),
          friendly: bullet.friendly,
        })),
        bursts: state.bursts.map((burst) => ({
          id: burst.id,
          x: burst.x,
          y: burst.y,
          size: burst.size,
          elapsed: burst.elapsed,
          particles: burst.sim.liveCount,
        })),
        simTime: state.simTime,
      };
    },

    setScreen(screen) {
      read().screen = screen;
    },

    setPhase(phase) {
      read().phase = phase;
    },

    setPhaseTimer(seconds) {
      read().phaseTimer = atLeast(seconds);
    },

    setMenuIndex(index) {
      read().menuIndex = Math.max(0, Math.round(index));
    },

    /**
     * The score alone. It grants no extra life whatever boundary it carries the
     * score across, and leaves the latch exactly as it stands: the award belongs
     * to the scoring path, and this is a precondition.
     */
    setScore(score) {
      read().score = score;
    },

    setLives(lives) {
      read().lives = lives;
    },

    /** The stage alone: it spawns nothing and clears nothing. */
    setStage(stage) {
      read().stage = Math.max(1, Math.round(stage));
    },

    setExtraLifeAwarded(awarded) {
      read().extraLifeAwarded = awarded;
    },

    setWaveEntry(enabled) {
      read().waveEntry = enabled;
    },

    setDiveLaunching(enabled) {
      read().diveLaunching = enabled;
    },

    setShipContact(enabled) {
      read().ship.contact = enabled;
    },

    setDiveClock(seconds) {
      read().diveClock = atLeast(seconds);
    },

    /** The ship's centre, with the lane's own clamp applied. */
    setShipX(x) {
      placeShip(read(), x);
    },

    /** The band the ship holds. It starts no fire lockout. */
    setShipBand(band) {
      read().ship.band = band;
    },

    setFireLockout(seconds) {
      read().ship.lockout = atLeast(seconds);
    },

    setFireCooldown(seconds) {
      read().ship.cooldown = atLeast(seconds);
    },

    setResonance(value) {
      read().resonance = Math.max(0, Math.min(RESONANCE_MAX, value));
    },

    setInversion(seconds) {
      read().inversion = atLeast(seconds);
    },

    /** One drone, which the game's own rules then move from there. */
    addDrone(kind, x, y) {
      addDroneTo(read(), kind, x, y);
    },

    setDronePosition(id, x, y) {
      const entry = drone(id);
      if (entry === undefined) return;
      entry.x = x;
      entry.y = y;
    },

    /** The drone's stored band. It moves the band and nothing else. */
    setDroneBand(id, band) {
      const entry = drone(id);
      if (entry !== undefined) entry.band = band;
    },

    setDronePhase(id, phase) {
      const entry = drone(id);
      if (entry !== undefined) setDronePhase(entry, phase);
    },

    setDroneSlot(id, x, y) {
      const entry = drone(id);
      if (entry === undefined) return;
      entry.slotX = x;
      entry.slotY = y;
    },

    /**
     * How far a Flux is into its current band window, from `0` to
     * `fluxWindow(stage)`. It moves the clock and nothing else: `shimmer` follows
     * it, and `band` does not change.
     */
    setDroneBandClock(id, seconds) {
      const state = read();
      const entry = droneById(state, id);
      if (entry === undefined) return;
      entry.bandClock = Math.max(
        0,
        Math.min(fluxWindowAt(state.stage), seconds),
      );
    },

    setDroneShell(id, intact) {
      const entry = drone(id);
      if (entry !== undefined) entry.shellAlive = intact;
    },

    setDroneCharge(id, charge) {
      const entry = drone(id);
      if (entry !== undefined) entry.charge = clampCharge(charge);
    },

    setDroneTravel(id, enabled) {
      const entry = drone(id);
      if (entry !== undefined) entry.travel = enabled;
    },

    setDroneOscillation(id, enabled) {
      const entry = drone(id);
      if (entry !== undefined) entry.oscillation = enabled;
    },

    setDroneFire(id, enabled) {
      const entry = drone(id);
      if (entry !== undefined) entry.fire = enabled;
    },

    removeDrone(id) {
      dropDrone(read(), id);
    },

    clearDrones() {
      read().drones = [];
    },

    /** One of the player's bullets in flight, climbing at its own speed. */
    addPlayerBullet(x, y, band) {
      addPlayerBulletTo(read(), x, y, band);
    },

    /** One enemy bullet in flight, falling at the current stage's speed. */
    addEnemyBullet(x, y, band) {
      addEnemyBulletTo(read(), x, y, band);
    },

    setBulletVelocity(id, vx, vy) {
      const bullet = read().bullets.find((entry) => entry.id === id);
      if (bullet === undefined) return;
      bullet.vx = vx;
      bullet.vy = vy;
    },

    removeBullet(id) {
      dropBullet(read(), id);
    },

    clearPlayerBullets() {
      const state = read();
      state.bullets = state.bullets.filter((bullet) => !bullet.friendly);
    },

    clearEnemyBullets() {
      const state = read();
      state.bullets = state.bullets.filter((bullet) => bullet.friendly);
    },

    removeBurst(id) {
      dropBurst(read(), id);
    },

    clearBursts() {
      read().bursts = [];
    },
  };
}
