// Spectra — the debugging and automation surface (`specs/instrumentation.md`).
//
// `createDebugApi()` builds it and `initialize` returns it beside the state, as
// `[state, createDebugApi()]`. The engine holds the second element and hands it back
// from `engine.debug`, and that is the one way a caller reaches it: nothing is
// installed on the page. It reaches nothing global, holds no state, and is inert
// during normal play.
//
// Every operation is written in the shape of `update`, because nothing in this
// build holds a writable state. A POSE takes the current state and returns the next
// one, and a caller drives it through the engine, as
// `engine.apply((s) => engine.debug.setShipBand(s, "magenta"))`. A READING takes the
// current state and returns what it read, as `debug.snapshot(engine.state)`.
//
// Each pose SETS ONE FIELD and takes scalars. There is no operation that takes a
// layout, no operation that arranges several things at once, and no operation that
// fabricates an outcome: a pose puts the game into a situation, and the game's own
// stepping, contact, band, scoring and stage rules are what run from there when the
// engine advances a frame. There is no operation that flips, fires or discharges,
// because each of those is an outcome a caller drives through the real action and
// reads back.
//
// Everything about DRIVING A BROWSER GAME rather than about Spectra belongs to the
// engine and is deliberately absent: no clock operation (the engine owns the clock
// and runs exact frames), no key operation (the registered actions are driven
// directly), no overlay toggle (the engine draws the panel and owns the backtick
// key), and no `setMuted` (the engine owns the mute bit; the `mute` binding sets it
// and the snapshot reports it).

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
  fluxWindow,
  isChallengeStage,
} from "./constants";
import {
  dischargeReady,
  effectiveBulletBand,
  effectiveDroneBand,
  inversionActive,
  shimmering,
  shipAlive,
} from "./bands";
import {
  addEnemyBullet as addEnemyBulletAt,
  addPlayerBullet as addPlayerBulletAt,
} from "./bullets";
import { NO_GROUP } from "./drones";
import { resetToTitle } from "./flow";
import { MODE } from "./overload";
import { bulletById, droneById, toSim, type MutDrone, type Sim } from "./sim";
import { freshDrone } from "./wave";
import type {
  Band,
  DroneKind,
  DronePhase,
  Phase,
  Screen,
  SpectraState,
} from "./game";
import type { DeepReadonly } from "ts-essentials";

/** One drone, as the snapshot reports it. */
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

/** One bullet, as the snapshot reports it. */
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

/** One drone-burst, as the snapshot reports it. */
export interface SnapshotBurst {
  id: number;
  x: number;
  y: number;
  size: number;
  elapsed: number;
  particles: number;
}

/** The plain, JSON-serializable view `snapshot` returns. */
export interface SpectraSnapshot {
  version: number;
  screen: Screen;
  phase: Phase;
  phaseTimer: number;
  menuIndex: number;
  mode: string;
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
  drones: SnapshotDrone[];
  bullets: SnapshotBullet[];
  bursts: SnapshotBurst[];
  simTime: number;
}

/** One pose over the state, as the engine's `Transition` shape. */
type Pose = (state: DeepReadonly<SpectraState>) => SpectraState;

/** The surface `initialize` returns beside the state. */
export interface SpectraDebugApi {
  version: number;

  reset(
    state: DeepReadonly<SpectraState>,
    options?: { seed?: number },
  ): SpectraState;
  snapshot(state: DeepReadonly<SpectraState>): SpectraSnapshot;

  setScreen(state: DeepReadonly<SpectraState>, screen: Screen): SpectraState;
  setPhase(state: DeepReadonly<SpectraState>, phase: Phase): SpectraState;
  setPhaseTimer(
    state: DeepReadonly<SpectraState>,
    seconds: number,
  ): SpectraState;
  setMenuIndex(state: DeepReadonly<SpectraState>, n: number): SpectraState;
  setScore(state: DeepReadonly<SpectraState>, n: number): SpectraState;
  setLives(state: DeepReadonly<SpectraState>, n: number): SpectraState;
  setStage(state: DeepReadonly<SpectraState>, n: number): SpectraState;
  setExtraLifeAwarded(
    state: DeepReadonly<SpectraState>,
    awarded: boolean,
  ): SpectraState;

  setWaveEntry(
    state: DeepReadonly<SpectraState>,
    enabled: boolean,
  ): SpectraState;
  setDiveLaunching(
    state: DeepReadonly<SpectraState>,
    enabled: boolean,
  ): SpectraState;
  setShipContact(
    state: DeepReadonly<SpectraState>,
    enabled: boolean,
  ): SpectraState;
  setDiveClock(
    state: DeepReadonly<SpectraState>,
    seconds: number,
  ): SpectraState;

  setShipX(state: DeepReadonly<SpectraState>, x: number): SpectraState;
  setShipBand(state: DeepReadonly<SpectraState>, band: Band): SpectraState;
  setFireLockout(
    state: DeepReadonly<SpectraState>,
    seconds: number,
  ): SpectraState;
  setFireCooldown(
    state: DeepReadonly<SpectraState>,
    seconds: number,
  ): SpectraState;

  setResonance(state: DeepReadonly<SpectraState>, value: number): SpectraState;
  setInversion(
    state: DeepReadonly<SpectraState>,
    seconds: number,
  ): SpectraState;

  addDrone(
    state: DeepReadonly<SpectraState>,
    kind: DroneKind,
    x: number,
    y: number,
  ): SpectraState;
  setDronePosition(
    state: DeepReadonly<SpectraState>,
    id: number,
    x: number,
    y: number,
  ): SpectraState;
  setDroneBand(
    state: DeepReadonly<SpectraState>,
    id: number,
    band: Band,
  ): SpectraState;
  setDronePhase(
    state: DeepReadonly<SpectraState>,
    id: number,
    phase: DronePhase,
  ): SpectraState;
  setDroneSlot(
    state: DeepReadonly<SpectraState>,
    id: number,
    x: number,
    y: number,
  ): SpectraState;
  setDroneBandClock(
    state: DeepReadonly<SpectraState>,
    id: number,
    seconds: number,
  ): SpectraState;
  setDroneShell(
    state: DeepReadonly<SpectraState>,
    id: number,
    intact: boolean,
  ): SpectraState;
  setDroneCharge(
    state: DeepReadonly<SpectraState>,
    id: number,
    charge: number,
  ): SpectraState;
  setDroneTravel(
    state: DeepReadonly<SpectraState>,
    id: number,
    enabled: boolean,
  ): SpectraState;
  setDroneOscillation(
    state: DeepReadonly<SpectraState>,
    id: number,
    enabled: boolean,
  ): SpectraState;
  setDroneFire(
    state: DeepReadonly<SpectraState>,
    id: number,
    enabled: boolean,
  ): SpectraState;
  removeDrone(state: DeepReadonly<SpectraState>, id: number): SpectraState;
  clearDrones(state: DeepReadonly<SpectraState>): SpectraState;

  addPlayerBullet(
    state: DeepReadonly<SpectraState>,
    x: number,
    y: number,
    band: Band,
  ): SpectraState;
  addEnemyBullet(
    state: DeepReadonly<SpectraState>,
    x: number,
    y: number,
    band: Band,
  ): SpectraState;
  setBulletVelocity(
    state: DeepReadonly<SpectraState>,
    id: number,
    vx: number,
    vy: number,
  ): SpectraState;
  removeBullet(state: DeepReadonly<SpectraState>, id: number): SpectraState;
  clearPlayerBullets(state: DeepReadonly<SpectraState>): SpectraState;
  clearEnemyBullets(state: DeepReadonly<SpectraState>): SpectraState;

  removeBurst(state: DeepReadonly<SpectraState>, id: number): SpectraState;
  clearBursts(state: DeepReadonly<SpectraState>): SpectraState;
}

/** Write `change` into a copy of the state and hand the copy back. */
function pose(change: (sim: Sim) => void): Pose {
  return (state) => {
    const sim = toSim(state);
    change(sim);
    return sim;
  };
}

/** Apply `change` to the drone with that id, and leave the state alone otherwise. */
function poseDrone(id: number, change: (drone: MutDrone) => void): Pose {
  return pose((sim) => {
    const drone = droneById(sim, id);
    if (drone !== undefined) change(drone);
  });
}

/** A value held inside `[lo, hi]`. */
function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

/** A whole number held inside `[lo, hi]`. */
function whole(value: number, lo: number, hi: number): number {
  return clamp(Math.round(value), lo, hi);
}

/** The surface. Every member is one pose or one reading. */
export function createDebugApi(): SpectraDebugApi {
  return {
    version: SPECTRA_DEBUG_VERSION,

    // ---- The core --------------------------------------------------------

    reset: (state, options) =>
      pose((sim) => {
        resetToTitle(sim, options?.seed ?? DEFAULT_SEED);
      })(state),

    snapshot: (state) => snapshot(state),

    // ---- The screen and the run ------------------------------------------

    setScreen: (state, screen) =>
      pose((sim) => {
        sim.screen = screen;
      })(state),

    setPhase: (state, phase) =>
      pose((sim) => {
        sim.phase = phase;
      })(state),

    setPhaseTimer: (state, seconds) =>
      pose((sim) => {
        sim.phaseTimer = Math.max(0, seconds);
      })(state),

    setMenuIndex: (state, n) =>
      pose((sim) => {
        sim.menuIndex = Math.max(0, Math.round(n));
      })(state),

    // A pose is a precondition, so no extra life is granted here whatever
    // boundary the score is carried across, and the latch is left as it stands.
    setScore: (state, n) =>
      pose((sim) => {
        sim.score = n;
      })(state),

    setLives: (state, n) =>
      pose((sim) => {
        sim.lives = Math.max(0, Math.round(n));
      })(state),

    // The stage's four derived figures and `isChallenge` all follow this, and
    // nothing is spawned or cleared by setting it.
    setStage: (state, n) =>
      pose((sim) => {
        sim.stage = Math.max(1, Math.round(n));
      })(state),

    setExtraLifeAwarded: (state, awarded) =>
      pose((sim) => {
        sim.extraLifeAwarded = awarded;
      })(state),

    // ---- The world gates and the dive clock ------------------------------

    setWaveEntry: (state, enabled) =>
      pose((sim) => {
        sim.waveEntry = enabled;
      })(state),

    setDiveLaunching: (state, enabled) =>
      pose((sim) => {
        sim.diveLaunching = enabled;
      })(state),

    setShipContact: (state, enabled) =>
      pose((sim) => {
        sim.ship.contact = enabled;
      })(state),

    setDiveClock: (state, seconds) =>
      pose((sim) => {
        sim.diveClock = Math.max(0, seconds);
      })(state),

    // ---- The ship and its cannon -----------------------------------------

    setShipX: (state, x) =>
      pose((sim) => {
        sim.ship.x = clamp(x, SHIP_X_MIN, SHIP_X_MAX);
      })(state),

    // The band the ship holds, and nothing else: no fire lockout is started.
    setShipBand: (state, band) =>
      pose((sim) => {
        sim.ship.band = band;
      })(state),

    setFireLockout: (state, seconds) =>
      pose((sim) => {
        sim.ship.lockout = Math.max(0, seconds);
      })(state),

    setFireCooldown: (state, seconds) =>
      pose((sim) => {
        sim.ship.cooldown = Math.max(0, seconds);
      })(state),

    // ---- Resonance and the inversion -------------------------------------

    setResonance: (state, value) =>
      pose((sim) => {
        sim.resonance = clamp(value, 0, RESONANCE_MAX);
      })(state),

    setInversion: (state, seconds) =>
      pose((sim) => {
        sim.inversion = Math.max(0, seconds);
      })(state),

    // ---- The drones ------------------------------------------------------

    addDrone: (state, kind, x, y) =>
      pose((sim) => {
        const drone = freshDrone(sim, kind, x, y, "cyan");
        drone.phase = "formation";
        // It arrived with no wave, so no stage clears when it is destroyed.
        drone.entryGroup = NO_GROUP;
        sim.drones.push(drone);
      })(state),

    setDronePosition: (state, id, x, y) =>
      poseDrone(id, (drone) => {
        drone.x = x;
        drone.y = y;
      })(state),

    // The stored band, on every kind. It moves the band and nothing else: the
    // band clock stays exactly where it stands.
    setDroneBand: (state, id, band) =>
      poseDrone(id, (drone) => {
        drone.band = band;
      })(state),

    setDronePhase: (state, id, phase) =>
      poseDrone(id, (drone) => {
        drone.phase = phase;
        drone.phaseClock = 0;
        drone.shotsFired = 0;
      })(state),

    setDroneSlot: (state, id, x, y) =>
      poseDrone(id, (drone) => {
        drone.slotX = x;
        drone.slotY = y;
      })(state),

    // The position inside the current band window. `shimmer` follows it, and the
    // stored band does not change.
    setDroneBandClock: (state, id, seconds) =>
      pose((sim) => {
        const drone = droneById(sim, id);
        if (drone === undefined) return;
        drone.bandClock = clamp(seconds, 0, fluxWindow(sim.stage));
      })(state),

    setDroneShell: (state, id, intact) =>
      poseDrone(id, (drone) => {
        drone.shellAlive = intact;
      })(state),

    setDroneCharge: (state, id, charge) =>
      poseDrone(id, (drone) => {
        drone.charge = whole(charge, 0, OVERLOAD_AT);
      })(state),

    setDroneTravel: (state, id, enabled) =>
      poseDrone(id, (drone) => {
        drone.travel = enabled;
      })(state),

    setDroneOscillation: (state, id, enabled) =>
      poseDrone(id, (drone) => {
        drone.oscillation = enabled;
      })(state),

    setDroneFire: (state, id, enabled) =>
      poseDrone(id, (drone) => {
        drone.fire = enabled;
      })(state),

    removeDrone: (state, id) =>
      pose((sim) => {
        sim.drones = sim.drones.filter((drone) => drone.id !== id);
      })(state),

    clearDrones: (state) =>
      pose((sim) => {
        sim.drones = [];
      })(state),

    // ---- The bullets -----------------------------------------------------

    addPlayerBullet: (state, x, y, band) =>
      pose((sim) => {
        addPlayerBulletAt(sim, x, y, band);
      })(state),

    addEnemyBullet: (state, x, y, band) =>
      pose((sim) => {
        addEnemyBulletAt(sim, x, y, band);
      })(state),

    setBulletVelocity: (state, id, vx, vy) =>
      pose((sim) => {
        const bullet = bulletById(sim, id);
        if (bullet === undefined) return;
        bullet.vx = vx;
        bullet.vy = vy;
      })(state),

    removeBullet: (state, id) =>
      pose((sim) => {
        sim.bullets = sim.bullets.filter((bullet) => bullet.id !== id);
      })(state),

    clearPlayerBullets: (state) =>
      pose((sim) => {
        sim.bullets = sim.bullets.filter((bullet) => !bullet.friendly);
      })(state),

    clearEnemyBullets: (state) =>
      pose((sim) => {
        sim.bullets = sim.bullets.filter((bullet) => bullet.friendly);
      })(state),

    // ---- The bursts ------------------------------------------------------

    removeBurst: (state, id) =>
      pose((sim) => {
        sim.bursts = sim.bursts.filter((burst) => burst.id !== id);
      })(state),

    clearBursts: (state) =>
      pose((sim) => {
        sim.bursts = [];
      })(state),
  };
}

/** A pure read of the state, as the shape `specs/instrumentation.md` fixes. */
function snapshot(state: DeepReadonly<SpectraState>): SpectraSnapshot {
  const stage = state.stage;
  const inversion = state.inversion;
  return {
    version: SPECTRA_DEBUG_VERSION,
    screen: state.screen,
    phase: state.phase,
    phaseTimer: state.phaseTimer,
    menuIndex: state.menuIndex,
    mode: MODE,
    stage,
    isChallenge: isChallengeStage(stage),
    score: state.score,
    lives: state.lives,
    extraLifeAwarded: state.extraLifeAwarded,
    resonance: state.resonance,
    dischargeReady: dischargeReady(state.resonance),
    inversion,
    inversionActive: inversionActive(inversion),
    muted: state.muted,
    waveEntry: state.waveEntry,
    diveLaunching: state.diveLaunching,
    diveClock: state.diveClock,
    droneSpeedScale: droneSpeedScale(stage),
    bulletSpeedScale: bulletSpeedScale(stage),
    diveGapScale: diveGapScale(stage),
    fluxHold: fluxHold(stage),
    ship: {
      x: state.ship.x,
      band: state.ship.band,
      alive: shipAlive(state.phase),
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
      effectiveBand: effectiveDroneBand(drone, stage, inversion),
      phase: drone.phase,
      slotX: drone.slotX,
      slotY: drone.slotY,
      bandClock: drone.bandClock,
      shimmer: shimmering(drone, stage),
      shellAlive: drone.shellAlive,
      travel: drone.travel,
      oscillation: drone.oscillation,
      fire: drone.fire,
      charge: drone.charge,
    })),
    bullets: state.bullets.map((bullet) => ({
      id: bullet.id,
      x: bullet.x,
      y: bullet.y,
      vx: bullet.vx,
      vy: bullet.vy,
      band: bullet.band,
      effectiveBand: effectiveBulletBand(bullet, inversion),
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
}
