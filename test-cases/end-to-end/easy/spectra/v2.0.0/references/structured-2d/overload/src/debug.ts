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
// THE FOUR WORLD GATES are worth naming: `setWaveEntry`, `setDiveLaunching`,
// `setStageClearing` and `setShipContact` each hold ONE faculty of the wave or the
// stage itself, default to on, are restored to on by `reset`, and are reported by
// `snapshot`. With the four of them off, nothing the caller did not ask for arrives,
// launches, ends the stage, or costs a life.
//
// The surface holds no state and is inert during normal play: nothing below runs
// until something calls it.

import type { World } from "@clockwyrks/structured-2d";
import {
  DEFAULT_SEED,
  OVERLOAD_AT,
  RESONANCE_MAX,
  SHIP_X_MAX,
  SHIP_X_MIN,
  SPECTRA_DEBUG_VERSION,
  bulletSpeedScale,
  diveGapScale,
  droneSpeedScale,
  fluxHold,
  isChallengeStage,
} from "./constants";
import { bulletEffectiveBand, droneEffectiveBand, shimmering } from "./bands";
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
import { menuItemRect, type MenuRect } from "./menus";
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
  challengeHits: number;
  resonance: number;
  dischargeReady: boolean;
  inversion: number;
  inversionActive: boolean;
  muted: boolean;
  waveEntry: boolean;
  diveLaunching: boolean;
  stageClearing: boolean;
  diveClock: number;
  diveGap: number;
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
  /** Bring every reported reading into agreement with the game as it stands. */
  reconcile(): void;
  menuItemRect(index: number): MenuRect | null;

  setScreen(screen: Screen): void;
  setPhase(phase: Phase): void;
  setPhaseTimer(seconds: number): void;
  setMenuIndex(index: number): void;
  setScore(score: number): void;
  setLives(lives: number): void;
  setStage(stage: number): void;
  setExtraLifeAwarded(awarded: boolean): void;
  setChallengeHits(hits: number): void;

  setWaveEntry(enabled: boolean): void;
  setDiveLaunching(enabled: boolean): void;
  setStageClearing(enabled: boolean): void;
  setShipContact(enabled: boolean): void;
  setDiveClock(seconds: number): void;
  setDiveGap(seconds: number): void;

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

  /**
   * The drone with that id, or a caller error naming the id.
   *
   * AN OPERATION IS UNCONDITIONAL, so an id no live drone carries names no state
   * to reach and THROWS where the caller sees it, rather than leaving the pose to
   * return with the roster exactly as it was: a pose that vanished would grade a
   * check that never addressed the drone it meant to as one that did.
   */
  const drone = (op: string, id: number): DroneState => {
    const found = droneById(read(), id);
    if (found === undefined) {
      throw new RangeError(`Spectra: ${op} names no live drone with id ${id}`);
    }
    return found;
  };

  /**
   * The drone with that id, of that kind, or a caller error naming both.
   *
   * A band window belongs to a Flux and a shell to a Prism, so posing either on
   * a drone that has none names no state to reach.
   */
  const droneOfKind = (op: string, id: number, kind: DroneKind): DroneState => {
    const found = drone(op, id);
    if (found.kind !== kind) {
      throw new RangeError(
        `Spectra: ${op} needs a ${kind}, and drone ${id} is a ${found.kind}`,
      );
    }
    return found;
  };

  /** One entry of a roster by id, or a caller error naming the id. */
  const requireId = <T extends { id: number }>(
    op: string,
    roster: readonly T[],
    id: number,
  ): T => {
    const found = roster.find((entry) => entry.id === id);
    if (found === undefined) {
      throw new RangeError(`Spectra: ${op} names no live entry with id ${id}`);
    }
    return found;
  };

  /**
   * The finite number the caller passed, at or above `floor`.
   *
   * The floor is a bound `specs/instrumentation.md` fixes as a constant, so it
   * is the argument's DOMAIN rather than an edge to snap to: a call outside it
   * fails loudly rather than being clamped into range, which would leave the
   * state holding a value nobody asked for.
   */
  const atLeast = (op: string, value: number, floor = 0): number => {
    if (!Number.isFinite(value) || value < floor) {
      throw new RangeError(
        `Spectra: ${op} needs a finite number at or above ${floor}, got ${String(value)}`,
      );
    }
    return value;
  };

  /** The finite number the caller passed, inside the closed range the specs fix. */
  const inRange = (
    op: string,
    value: number,
    lo: number,
    hi: number,
  ): number => {
    if (!Number.isFinite(value) || value < lo || value > hi) {
      throw new RangeError(
        `Spectra: ${op} needs a finite number in [${lo}, ${hi}], got ${String(value)}`,
      );
    }
    return value;
  };

  return {
    version: SPECTRA_DEBUG_VERSION,

    reset(options) {
      resetState(read(), options?.seed ?? DEFAULT_SEED);
    },

    /**
     * Bring every reported reading into agreement with the game as it stands.
     *
     * Every derived reading this build reports — `isChallenge`, the four
     * stage-scaled figures, `dischargeReady`, `inversionActive`, `ship.alive`,
     * every `effectiveBand`, a Flux's `shimmer` and a burst's `particles` — is
     * worked out at the READ, in `snapshot` below, from the stage, the resonance,
     * the inversion, the phase and the bands beside it. Nothing is held that a
     * pose can leave behind, so there is nothing here to rewrite and this body is
     * the answer rather than an omission.
     *
     * The operation is required of EVERY build, including one that keeps those
     * readings as stored copies and must rewrite them from their sources here.
     * This is what it comes to in a build that does not. It advances no clock,
     * runs no system, fires nothing, and corrects nothing.
     */
    reconcile() {},

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
        challengeHits: state.challengeHits,
        resonance: state.resonance,
        dischargeReady: state.resonance >= RESONANCE_MAX,
        inversion: state.inversion,
        inversionActive: state.inversion > 0,
        muted: state.muted,
        waveEntry: state.waveEntry,
        diveLaunching: state.diveLaunching,
        stageClearing: state.stageClearing,
        diveClock: state.diveClock,
        diveGap: state.diveTarget,
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

    /**
     * A pure read of the hit region of item `index` on the menu the current screen
     * shows, in logical units. It changes nothing.
     *
     * Null on the four screens that show no menu, and null for an index the current
     * menu has no item at (`specs/instrumentation.md`). The region is the one
     * `src/menus.ts` lays out, which is the one `src/render.ts` draws the item's
     * plate at and the one the pointer selects on.
     */
    menuItemRect(index) {
      return menuItemRect(read().screen, index);
    },

    setScreen(screen) {
      read().screen = screen;
    },

    setPhase(phase) {
      read().phase = phase;
    },

    setPhaseTimer(seconds) {
      read().phaseTimer = atLeast("setPhaseTimer(seconds)", seconds);
    },

    setMenuIndex(index) {
      read().menuIndex = Math.round(atLeast("setMenuIndex(n)", index));
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
      read().stage = Math.round(atLeast("setStage(n)", stage, 1));
    },

    setExtraLifeAwarded(awarded) {
      read().extraLifeAwarded = awarded;
    },

    /**
     * Set the current challenge stage's tally of drones destroyed.
     *
     * It destroys nothing and pays nothing: it is the latch alone, and the
     * bonus belongs to the scoring path.
     */
    setChallengeHits(hits) {
      read().challengeHits = Math.round(atLeast("setChallengeHits(n)", hits));
    },

    setWaveEntry(enabled) {
      read().waveEntry = enabled;
    },

    setDiveLaunching(enabled) {
      read().diveLaunching = enabled;
    },

    setStageClearing(enabled) {
      read().stageClearing = enabled;
    },

    setShipContact(enabled) {
      read().ship.contact = enabled;
    },

    setDiveClock(seconds) {
      read().diveClock = atLeast("setDiveClock(seconds)", seconds);
    },

    setDiveGap(seconds) {
      read().diveTarget = atLeast("setDiveGap(seconds)", seconds);
    },

    /**
     * The ship's centre, at the `x` it was GIVEN.
     *
     * The lane's bounds are the argument's domain rather than an edge to snap
     * to, so a value outside them fails loudly instead of landing the ship
     * somewhere nobody asked for.
     */
    setShipX(x) {
      read().ship.x = inRange("setShipX(x)", x, SHIP_X_MIN, SHIP_X_MAX);
    },

    /** The band the ship holds. It starts no fire lockout. */
    setShipBand(band) {
      read().ship.band = band;
    },

    setFireLockout(seconds) {
      read().ship.lockout = atLeast("setFireLockout(seconds)", seconds);
    },

    setFireCooldown(seconds) {
      read().ship.cooldown = atLeast("setFireCooldown(seconds)", seconds);
    },

    setResonance(value) {
      read().resonance = inRange(
        "setResonance(value)",
        value,
        0,
        RESONANCE_MAX,
      );
    },

    setInversion(seconds) {
      read().inversion = atLeast("setInversion(seconds)", seconds);
    },

    /** One drone, which the game's own rules then move from there. */
    addDrone(kind, x, y) {
      addDroneTo(read(), kind, x, y);
    },

    setDronePosition(id, x, y) {
      const entry = drone("setDronePosition", id);
      entry.x = x;
      entry.y = y;
    },

    /** The drone's stored band. It moves the band and nothing else. */
    setDroneBand(id, band) {
      drone("setDroneBand", id).band = band;
    },

    setDronePhase(id, phase) {
      setDronePhase(drone("setDronePhase", id), phase);
    },

    setDroneSlot(id, x, y) {
      const entry = drone("setDroneSlot", id);
      entry.slotX = x;
      entry.slotY = y;
    },

    /**
     * How far a Flux is into its current band window, in seconds from `0`.
     *
     * The seconds it was HANDED, whatever `fluxWindow(stage)` is at the time:
     * the window is a live figure the stage moves, so it is a game rule rather
     * than this argument's domain, and a clock posed past the end of the window
     * stays where it was put until the oscillation reaches it. It moves the
     * clock and nothing else: `shimmer` follows it, and `band` does not change.
     */
    setDroneBandClock(id, seconds) {
      droneOfKind("setDroneBandClock", id, "flux").bandClock = atLeast(
        "setDroneBandClock(seconds)",
        seconds,
      );
    },

    setDroneShell(id, intact) {
      droneOfKind("setDroneShell", id, "prism").shellAlive = intact;
    },

    setDroneCharge(id, charge) {
      drone("setDroneCharge", id).charge = Math.round(
        inRange("setDroneCharge(charge)", charge, 0, OVERLOAD_AT),
      );
    },

    setDroneTravel(id, enabled) {
      drone("setDroneTravel", id).travel = enabled;
    },

    setDroneOscillation(id, enabled) {
      drone("setDroneOscillation", id).oscillation = enabled;
    },

    setDroneFire(id, enabled) {
      drone("setDroneFire", id).fire = enabled;
    },

    removeDrone(id) {
      const state = read();
      requireId("removeDrone", state.drones, id);
      dropDrone(state, id);
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
      const bullet = requireId("setBulletVelocity", read().bullets, id);
      bullet.vx = vx;
      bullet.vy = vy;
    },

    removeBullet(id) {
      const state = read();
      requireId("removeBullet", state.bullets, id);
      dropBullet(state, id);
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
      const state = read();
      requireId("removeBurst", state.bursts, id);
      dropBurst(state, id);
    },

    clearBursts() {
      read().bursts = [];
    },
  };
}
