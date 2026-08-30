// Spectra — the debugging and automation surface (`specs/instrumentation.md`).
//
// `createDebugApi` builds it and the game instance's `initialize` returns it. The
// engine holds that same object and hands it back from `engine.debug`, and that
// is the ONE way a caller reaches it: nothing is installed on the page. It holds
// no state of its own and is inert during normal play.
//
// Every operation acts on the LIVE game at the moment it is called, reaching the
// open world through the accessor the instance supplies — `engine.world` at the
// call, so the surface follows the world rather than holding one. A POSE takes
// only the parameters its own row names, arranges the running game, and returns
// nothing; a READING returns plain data built at the call and changes nothing.
//
// EACH POSE SETS ONE FIELD and takes scalars. There is no operation that takes a
// layout, none that arranges several things at once, and none that fabricates an
// outcome: a pose puts the game into a situation, and the game's own stepping,
// contact, band, scoring and stage rules are what run from there when the engine
// advances a frame. So there is no flip and no discharge — a caller drives the
// real action and reads the result — and no `addBurst`, because a burst is what a
// destroyed drone leaves behind.
//
// Everything about DRIVING A BROWSER GAME rather than about Spectra belongs to
// the engine and is deliberately absent: no clock operation (the engine owns the
// clock and `engine.advance` runs exact frames), no key operation (the registered
// actions are driven at the surface's event target), no overlay toggle (the
// engine draws the panel and owns the backtick key), and no `setMuted` (the
// engine owns the mute bit; the `mute` binding sets it and the snapshot reports
// the game's copy of it).

import {
  DEFAULT_SEED,
  ENEMY_BULLET_SPEED,
  PLAYER_BULLET_SPEED,
  RESONANCE_MAX,
  SPECTRA_DEBUG_VERSION,
  bulletSpeedScale,
  diveGapScale,
  droneSpeedScale,
  fluxHold,
  fluxWindow,
  isChallengeStage,
} from "./constants";
import { bulletBand, droneBand, inverted, isShimmering } from "./bands";
import { clampLane } from "./ship";
import { dischargeReady } from "./discharge";
import { resetToTitle } from "./flow";
import { waveBulletScale } from "./swarm";
import { bulletById, droneById, takeId } from "./entities";
import { spectraState, type SpectraState } from "./game";
import type {
  Band,
  DronePhase,
  DroneKind,
  DroneState,
  Phase,
  Screen,
} from "./game";
import type { World } from "@test-cabinet/structured-2d";

/** The plain, JSON-serializable view `snapshot` returns. */
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
  drones: {
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
  }[];
  bullets: {
    id: number;
    x: number;
    y: number;
    vx: number;
    vy: number;
    band: Band;
    effectiveBand: Band;
    friendly: boolean;
  }[];
  bursts: {
    id: number;
    x: number;
    y: number;
    size: number;
    elapsed: number;
    particles: number;
  }[];
  simTime: number;
}

/** The surface the game instance's `initialize` returns. */
export interface SpectraDebugApi {
  version: number;

  reset(options?: { seed?: number }): void;
  snapshot(): SpectraSnapshot;

  setScreen(screen: Screen): void;
  setPhase(phase: Phase): void;
  setPhaseTimer(seconds: number): void;
  setMenuIndex(n: number): void;
  setScore(n: number): void;
  setLives(n: number): void;
  setStage(n: number): void;
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

/** Seconds, never negative. */
function seconds(value: number): number {
  return Math.max(0, value);
}

/** The surface. Every member is one pose or one reading. */
export function createDebugApi(world: () => World): SpectraDebugApi {
  /** The live state, read at the call. */
  const read = (): SpectraState => spectraState(world());

  /** Apply `change` to the drone with that id, and do nothing otherwise. */
  const poseDrone = (
    id: number,
    change: (drone: DroneState, state: SpectraState) => void,
  ): void => {
    const state = read();
    const drone = droneById(state, id);
    if (drone !== undefined) change(drone, state);
  };

  return {
    version: SPECTRA_DEBUG_VERSION,

    reset(options) {
      resetToTitle(read(), options?.seed ?? DEFAULT_SEED);
    },

    snapshot() {
      const state = read();
      const swapped = inverted(state.inversion);
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
        dischargeReady: dischargeReady(state.resonance),
        inversion: state.inversion,
        inversionActive: swapped,
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
          // Derived: the ship is gone exactly while the wave holds its ready
          // phase (`specs/progression.md`).
          alive: state.phase !== "ready",
          lockout: state.ship.lockout,
          cooldown: state.ship.cooldown,
          contact: state.ship.contact,
        },
        discharge: {
          active: state.discharge.active,
          radius: state.discharge.radius,
        },
        drones: state.drones.map((drone) => ({
          id: drone.id,
          kind: drone.kind,
          x: drone.x,
          y: drone.y,
          band: drone.band,
          effectiveBand: droneBand(drone, state.stage, swapped),
          phase: drone.phase,
          slotX: drone.slotX,
          slotY: drone.slotY,
          bandClock: drone.bandClock,
          shimmer: isShimmering(drone, state.stage),
          shellAlive: drone.shellAlive,
          travel: drone.travel,
          oscillation: drone.oscillation,
          fire: drone.fire,
        })),
        bullets: state.bullets.map((bullet) => ({
          id: bullet.id,
          x: bullet.x,
          y: bullet.y,
          vx: bullet.vx,
          vy: bullet.vy,
          band: bullet.band,
          effectiveBand: bulletBand(bullet, swapped),
          friendly: bullet.friendly,
        })),
        bursts: state.bursts.map((burst) => ({
          id: burst.id,
          x: burst.x,
          y: burst.y,
          size: burst.size,
          elapsed: burst.elapsed,
          // Read off the burst's own simulation at the call.
          particles: burst.sim.liveCount,
        })),
        simTime: state.simTime,
      };
    },

    // ---- The screen and the run ------------------------------------------

    setScreen(screen) {
      read().screen = screen;
    },

    setPhase(phase) {
      read().phase = phase;
    },

    setPhaseTimer(value) {
      read().phaseTimer = seconds(value);
    },

    setMenuIndex(n) {
      read().menuIndex = Math.max(0, Math.round(n));
    },

    // A pose is a precondition, so no extra life is granted here whatever
    // boundary the score is carried across, and the latch is left as it stands.
    setScore(n) {
      read().score = n;
    },

    setLives(n) {
      read().lives = Math.max(0, Math.round(n));
    },

    // The stage's four derived figures and `isChallenge` all follow this, and
    // nothing is spawned or cleared by setting it.
    setStage(n) {
      read().stage = Math.max(1, Math.round(n));
    },

    setExtraLifeAwarded(awarded) {
      read().extraLifeAwarded = awarded;
    },

    // ---- The world gates and the dive clock -------------------------------

    setWaveEntry(enabled) {
      read().waveEntry = enabled;
    },

    setDiveLaunching(enabled) {
      read().diveLaunching = enabled;
    },

    setShipContact(enabled) {
      read().ship.contact = enabled;
    },

    setDiveClock(value) {
      read().diveClock = seconds(value);
    },

    // ---- The ship and its cannon ------------------------------------------

    setShipX(x) {
      read().ship.x = clampLane(x);
    },

    // The band the ship holds, and nothing else: no fire lockout is started,
    // because `setFireLockout` is what poses the lockout.
    setShipBand(band) {
      read().ship.band = band;
    },

    setFireLockout(value) {
      read().ship.lockout = seconds(value);
    },

    setFireCooldown(value) {
      read().ship.cooldown = seconds(value);
    },

    // ---- Resonance and the inversion --------------------------------------

    setResonance(value) {
      read().resonance = Math.max(0, Math.min(RESONANCE_MAX, value));
    },

    setInversion(value) {
      read().inversion = seconds(value);
    },

    // ---- The drones -------------------------------------------------------

    addDrone(kind, x, y) {
      const state = read();
      state.drones.push({
        id: takeId(state),
        kind,
        x,
        y,
        band: "cyan",
        phase: "formation",
        phaseClock: 0,
        slotX: x,
        slotY: y,
        entryGroup: 0,
        bandClock: 0,
        shellAlive: true,
        shotsFired: 0,
        travel: true,
        oscillation: true,
        fire: true,
      });
    },

    setDronePosition(id, x, y) {
      poseDrone(id, (drone) => {
        drone.x = x;
        drone.y = y;
      });
    },

    // The stored band, on every kind, and nothing else: the band clock stays
    // exactly where it stands.
    setDroneBand(id, band) {
      poseDrone(id, (drone) => {
        drone.band = band;
      });
    },

    // A phase change starts that phase's own path from its beginning, however
    // the change came about (`specs/state.md`).
    setDronePhase(id, phase) {
      poseDrone(id, (drone) => {
        drone.phase = phase;
        drone.phaseClock = 0;
        drone.shotsFired = 0;
      });
    },

    setDroneSlot(id, x, y) {
      poseDrone(id, (drone) => {
        drone.slotX = x;
        drone.slotY = y;
      });
    },

    // How far into the CURRENT band window the Flux is, and nothing else:
    // `shimmer` follows it and the stored band does not change.
    setDroneBandClock(id, value) {
      poseDrone(id, (drone, state) => {
        drone.bandClock = Math.max(0, Math.min(fluxWindow(state.stage), value));
      });
    },

    setDroneShell(id, intact) {
      poseDrone(id, (drone) => {
        drone.shellAlive = intact;
      });
    },

    setDroneTravel(id, enabled) {
      poseDrone(id, (drone) => {
        drone.travel = enabled;
      });
    },

    setDroneOscillation(id, enabled) {
      poseDrone(id, (drone) => {
        drone.oscillation = enabled;
      });
    },

    setDroneFire(id, enabled) {
      poseDrone(id, (drone) => {
        drone.fire = enabled;
      });
    },

    removeDrone(id) {
      const state = read();
      state.drones = state.drones.filter((drone) => drone.id !== id);
    },

    clearDrones() {
      read().drones = [];
    },

    // ---- The bullets ------------------------------------------------------

    addPlayerBullet(x, y, band) {
      const state = read();
      state.bullets.push({
        id: takeId(state),
        x,
        y,
        vx: 0,
        vy: -PLAYER_BULLET_SPEED,
        band,
        friendly: true,
      });
    },

    addEnemyBullet(x, y, band) {
      const state = read();
      state.bullets.push({
        id: takeId(state),
        x,
        y,
        vx: 0,
        vy: ENEMY_BULLET_SPEED * waveBulletScale(state.stage),
        band,
        friendly: false,
      });
    },

    setBulletVelocity(id, vx, vy) {
      const bullet = bulletById(read(), id);
      if (bullet === undefined) return;
      bullet.vx = vx;
      bullet.vy = vy;
    },

    removeBullet(id) {
      const state = read();
      state.bullets = state.bullets.filter((bullet) => bullet.id !== id);
    },

    clearPlayerBullets() {
      const state = read();
      state.bullets = state.bullets.filter((bullet) => !bullet.friendly);
    },

    clearEnemyBullets() {
      const state = read();
      state.bullets = state.bullets.filter((bullet) => bullet.friendly);
    },

    // ---- The bursts -------------------------------------------------------

    removeBurst(id) {
      const state = read();
      state.bursts = state.bursts.filter((burst) => burst.id !== id);
    },

    clearBursts() {
      read().bursts = [];
    },
  };
}
