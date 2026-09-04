// Spectra — the debugging and automation surface (`specs/instrumentation.md`).
//
// `createDebugApi()` builds it and `initialize` returns it beside the state, as
// `[state, createDebugApi()]`. The engine holds the second element and hands it
// back from `engine.debug`, and that is the ONE way a caller reaches it: nothing
// is installed on the page. It reaches nothing global, holds no state of its own,
// and is inert during normal play.
//
// Every operation is written in the shape of `update`, because nothing in this
// build holds a writable state. A POSE takes the current state and returns the
// next one, and a caller drives it through the engine, as
// `engine.apply((s) => engine.debug.setShipBand(s, "magenta"))`. A READING takes
// the current state and returns what it read, as `debug.snapshot(engine.state)`.
//
// Each pose SETS ONE FIELD and takes scalars. There is no operation that takes a
// layout, none that arranges several things at once, and none that fabricates an
// outcome: a pose puts the game into a situation, and the game's own stepping,
// contact, band, scoring and stage rules are what run from there when the engine
// advances a frame. So there is no flip and no discharge — a caller drives the
// real action and reads the result — and no `addBurst`, because a burst is what
// a destroyed drone leaves behind.
//
// Everything about DRIVING A BROWSER GAME rather than about Spectra belongs to
// the engine and is deliberately absent: no clock operation (the engine owns the
// clock and runs exact frames), no key operation (the registered actions are
// driven directly), no overlay toggle (the engine draws the panel and owns the
// backtick key), and no `setMuted` (the engine owns the mute bit; the `mute`
// binding sets it and the snapshot reports it).

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
import { menuItemRect, type MenuRect } from "./menus";
import {
  droneById,
  bulletById,
  takeId,
  toSim,
  type MutDrone,
  type Sim,
} from "./sim";
import type {
  Band,
  DronePhase,
  DroneKind,
  Phase,
  Screen,
  SpectraState,
} from "./game";
import type { DeepReadonly } from "ts-essentials";

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
  menuItemRect(
    state: DeepReadonly<SpectraState>,
    index: number,
  ): MenuRect | null;

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
function poseDrone(
  id: number,
  change: (drone: MutDrone, sim: Sim) => void,
): Pose {
  return pose((sim) => {
    const drone = droneById(sim, id);
    if (drone !== undefined) change(drone, sim);
  });
}

/** Seconds, never negative. */
function seconds(value: number): number {
  return Math.max(0, value);
}

/** The surface. Every member is one pose or one reading. */
export function createDebugApi(): SpectraDebugApi {
  return {
    version: SPECTRA_DEBUG_VERSION,

    reset: (state, options) =>
      pose((sim) => {
        resetToTitle(sim, options?.seed ?? DEFAULT_SEED);
      })(state),

    snapshot: (state) => {
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
          bandClock: drone.kind === "flux" ? drone.bandClock : 0,
          shimmer: isShimmering(drone, state.stage),
          shellAlive: drone.kind === "prism" ? drone.shellAlive : true,
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

    /**
     * A pure read of the hit region of item `index` on the menu the current screen
     * shows, in logical units. It changes nothing.
     *
     * Null on the four screens that show no menu, and null for an index the current
     * menu has no item at (`specs/instrumentation.md`). The region is the one
     * `src/menus.ts` lays out, which is the one `src/render.ts` draws the item in
     * and the one the pointer selects on.
     */
    menuItemRect: (state, index) => menuItemRect(state.screen, index),

    // ---- The screen and the run ------------------------------------------

    setScreen: (state, screen) =>
      pose((sim) => {
        sim.screen = screen;
      })(state),

    setPhase: (state, phase) =>
      pose((sim) => {
        sim.phase = phase;
      })(state),

    setPhaseTimer: (state, value) =>
      pose((sim) => {
        sim.phaseTimer = seconds(value);
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

    // ---- The world gates and the dive clock -------------------------------

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

    setDiveClock: (state, value) =>
      pose((sim) => {
        sim.diveClock = seconds(value);
      })(state),

    // ---- The ship and its cannon ------------------------------------------

    setShipX: (state, x) =>
      pose((sim) => {
        sim.ship.x = clampLane(x);
      })(state),

    // The band the ship holds, and nothing else: no fire lockout is started,
    // because `setFireLockout` is what poses the lockout.
    setShipBand: (state, band) =>
      pose((sim) => {
        sim.ship.band = band;
      })(state),

    setFireLockout: (state, value) =>
      pose((sim) => {
        sim.ship.lockout = seconds(value);
      })(state),

    setFireCooldown: (state, value) =>
      pose((sim) => {
        sim.ship.cooldown = seconds(value);
      })(state),

    // ---- Resonance and the inversion --------------------------------------

    setResonance: (state, value) =>
      pose((sim) => {
        sim.resonance = Math.max(0, Math.min(RESONANCE_MAX, value));
      })(state),

    setInversion: (state, value) =>
      pose((sim) => {
        sim.inversion = seconds(value);
      })(state),

    // ---- The drones -------------------------------------------------------

    addDrone: (state, kind, x, y) =>
      pose((sim) => {
        sim.drones.push({
          id: takeId(sim),
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
      })(state),

    setDronePosition: (state, id, x, y) =>
      poseDrone(id, (drone) => {
        drone.x = x;
        drone.y = y;
      })(state),

    // The stored band, on every kind, and nothing else: the band clock stays
    // exactly where it stands.
    setDroneBand: (state, id, band) =>
      poseDrone(id, (drone) => {
        drone.band = band;
      })(state),

    // A phase change starts that phase's own path from its beginning, however
    // the change came about (`specs/state.md`).
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

    // How far into the CURRENT band window the Flux is, and nothing else:
    // `shimmer` follows it and the stored band does not change.
    setDroneBandClock: (state, id, value) =>
      poseDrone(id, (drone, sim) => {
        drone.bandClock = Math.max(0, Math.min(fluxWindow(sim.stage), value));
      })(state),

    setDroneShell: (state, id, intact) =>
      poseDrone(id, (drone) => {
        drone.shellAlive = intact;
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

    // ---- The bullets ------------------------------------------------------

    addPlayerBullet: (state, x, y, band) =>
      pose((sim) => {
        sim.bullets.push({
          id: takeId(sim),
          x,
          y,
          vx: 0,
          vy: -PLAYER_BULLET_SPEED,
          band,
          friendly: true,
        });
      })(state),

    addEnemyBullet: (state, x, y, band) =>
      pose((sim) => {
        sim.bullets.push({
          id: takeId(sim),
          x,
          y,
          vx: 0,
          vy: ENEMY_BULLET_SPEED * bulletSpeedScale(sim.stage),
          band,
          friendly: false,
        });
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

    // ---- The bursts -------------------------------------------------------

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
