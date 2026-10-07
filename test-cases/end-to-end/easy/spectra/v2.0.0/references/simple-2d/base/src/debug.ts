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
// AN OPERATION IS UNCONDITIONAL. Every pose below applies its effect, reaching
// the value it was given rather than one the game's own rules would have
// preferred: nothing is clamped into range and nothing is declined. Where the
// specification fixes a domain — the lane's own bounds, `0` to `RESONANCE_MAX`, a
// floor of zero on a timer, an id a live drone, bullet or burst carries, a field
// only one KIND of drone has — that domain is checked and a call outside it
// THROWS, where the caller sees it. A bound that reads a LIVE game figure is not a
// domain at all: `fluxWindow(stage)` moves with the stage, so `setDroneBandClock`
// takes the seconds it was handed and leaves the carry-over to the oscillation.
// What nothing below does is refuse quietly: no pose returns a state equal to the
// one it was handed, because a surface that did that would hide the very systems a
// check drove it to reach.
//
// Everything about DRIVING A BROWSER GAME rather than about Spectra belongs to
// the engine and is deliberately absent: no clock operation (the engine owns the
// clock and runs exact frames), no key operation (the registered actions are
// driven directly), no overlay toggle (the engine draws the panel and owns the
// backtick key), and no `setMuted` (the engine owns the mute bit; the `mute`
// binding sets it and the snapshot reports it).

import {
  ENEMY_BULLET_SPEED,
  PLAYER_BULLET_SPEED,
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
import { bulletBand, droneBand, inverted, isShimmering } from "./bands";
import { dischargeReady } from "./discharge";
import { resetToTitle } from "./flow";
import { menuItemRect, type MenuRect } from "./menus";
import { droneById, takeId, toSim, type MutDrone, type Sim } from "./sim";
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

  reset(state: DeepReadonly<SpectraState>): SpectraState;
  snapshot(state: DeepReadonly<SpectraState>): SpectraSnapshot;
  /** Bring every reported reading into agreement with the game as it stands. */
  reconcile(state: DeepReadonly<SpectraState>): SpectraState;
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
  /**
   * Set the current challenge stage's tally of drones destroyed.
   *
   * It destroys nothing and pays nothing: it is the latch alone, and the bonus
   * belongs to the scoring path.
   */
  setChallengeHits(state: DeepReadonly<SpectraState>, n: number): SpectraState;

  setWaveEntry(
    state: DeepReadonly<SpectraState>,
    enabled: boolean,
  ): SpectraState;
  setDiveLaunching(
    state: DeepReadonly<SpectraState>,
    enabled: boolean,
  ): SpectraState;
  setStageClearing(
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
  setDiveGap(state: DeepReadonly<SpectraState>, seconds: number): SpectraState;

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

/**
 * Apply `change` to the drone with that id, or fail loudly naming the id.
 *
 * An id no live drone carries names no state to reach, so it THROWS where the
 * caller sees it rather than handing back the state it was given: a pose that
 * vanished would grade a check that never addressed the drone it meant to as one
 * that did.
 */
function poseDrone(
  op: string,
  id: number,
  change: (drone: MutDrone, sim: Sim) => void,
): Pose {
  return pose((sim) => {
    const drone = droneById(sim, id);
    if (drone === undefined) {
      throw new RangeError(`Spectra: ${op} names no live drone with id ${id}`);
    }
    change(drone, sim);
  });
}

/**
 * Apply `change` to the drone with that id, of that kind, or fail loudly.
 *
 * A band window belongs to a Flux and a shell to a Prism, so posing either on a
 * drone that has none names no state to reach.
 */
function poseDroneOfKind(
  op: string,
  id: number,
  kind: DroneKind,
  change: (drone: MutDrone, sim: Sim) => void,
): Pose {
  return poseDrone(op, id, (drone, sim) => {
    if (drone.kind !== kind) {
      throw new RangeError(
        `Spectra: ${op} needs a ${kind}, and drone ${id} is a ${drone.kind}`,
      );
    }
    change(drone, sim);
  });
}

/** One entry of a roster by id, or a caller error naming the id. */
function requireId<T extends { id: number }>(
  op: string,
  roster: readonly T[],
  id: number,
): T {
  const found = roster.find((entry) => entry.id === id);
  if (found === undefined) {
    throw new RangeError(`Spectra: ${op} names no live entry with id ${id}`);
  }
  return found;
}

/**
 * The finite number the caller passed, at or above `floor`.
 *
 * The floor is a bound `specs/instrumentation.md` fixes as a constant, so it is
 * the argument's DOMAIN rather than an edge to snap to: a call outside it fails
 * loudly rather than being clamped into range, which would leave the state
 * holding a value nobody asked for.
 */
function atLeast(op: string, value: number, floor: number): number {
  if (!Number.isFinite(value) || value < floor) {
    throw new RangeError(
      `Spectra: ${op} needs a finite number at or above ${floor}, got ${String(value)}`,
    );
  }
  return value;
}

/** The finite number the caller passed, inside the closed range the specs fix. */
function inRange(op: string, value: number, lo: number, hi: number): number {
  if (!Number.isFinite(value) || value < lo || value > hi) {
    throw new RangeError(
      `Spectra: ${op} needs a finite number in [${lo}, ${hi}], got ${String(value)}`,
    );
  }
  return value;
}

/** A finite, non-negative number of seconds; below zero is a caller error. */
function seconds(op: string, value: number): number {
  return atLeast(op, value, 0);
}

/** The surface. Every member is one pose or one reading. */
export function createDebugApi(): SpectraDebugApi {
  return {
    version: SPECTRA_DEBUG_VERSION,

    reset: (state) =>
      pose((sim) => {
        resetToTitle(sim);
      })(state),

    /**
     * Bring every reported reading into agreement with the game as it stands.
     *
     * Every derived reading this build reports — `isChallenge`, the four
     * stage-scaled figures, `dischargeReady`, `inversionActive`, `ship.alive`,
     * every `effectiveBand`, a Flux's `shimmer` and a burst's `particles` — is
     * worked out at the READ, in `snapshot` below, from the stage, the resonance,
     * the inversion, the phase and the bands beside it. Nothing is held that a
     * pose can leave behind, so there is nothing here to rewrite and the state
     * that comes back equals the one that went in.
     *
     * The operation is required of EVERY build, including one that keeps those
     * readings as stored copies and must rewrite them from their sources here.
     * This is what it comes to in a build that does not: it advances no frame,
     * runs no system, fires nothing, and corrects nothing. The empty `pose` is
     * what keeps the return type right without a cast.
     */
    reconcile: (state) => pose(() => {})(state),

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
        challengeHits: state.challengeHits,
        resonance: state.resonance,
        dischargeReady: dischargeReady(state.resonance),
        inversion: state.inversion,
        inversionActive: swapped,
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
        sim.phaseTimer = seconds("setPhaseTimer(seconds)", value);
      })(state),

    setMenuIndex: (state, n) =>
      pose((sim) => {
        sim.menuIndex = Math.round(atLeast("setMenuIndex(n)", n, 0));
      })(state),

    // A pose is a precondition, so no extra life is granted here whatever
    // boundary the score is carried across, and the latch is left as it stands.
    setScore: (state, n) =>
      pose((sim) => {
        sim.score = n;
      })(state),

    setLives: (state, n) =>
      pose((sim) => {
        sim.lives = Math.round(atLeast("setLives(n)", n, 0));
      })(state),

    // The stage's four derived figures and `isChallenge` all follow this, and
    // nothing is spawned or cleared by setting it.
    setStage: (state, n) =>
      pose((sim) => {
        sim.stage = Math.round(atLeast("setStage(n)", n, 1));
      })(state),

    setExtraLifeAwarded: (state, awarded) =>
      pose((sim) => {
        sim.extraLifeAwarded = awarded;
      })(state),

    setChallengeHits: (state, n) =>
      pose((sim) => {
        sim.challengeHits = Math.round(atLeast("setChallengeHits(n)", n, 0));
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

    setStageClearing: (state, enabled) =>
      pose((sim) => {
        sim.stageClearing = enabled;
      })(state),

    setShipContact: (state, enabled) =>
      pose((sim) => {
        sim.ship.contact = enabled;
      })(state),

    setDiveClock: (state, value) =>
      pose((sim) => {
        sim.diveClock = seconds("setDiveClock(seconds)", value);
      })(state),

    setDiveGap: (state, value) =>
      pose((sim) => {
        sim.diveTarget = seconds("setDiveGap(seconds)", value);
      })(state),

    // ---- The ship and its cannon ------------------------------------------

    // The `x` it was GIVEN. The lane's bounds are the argument's domain rather
    // than an edge to snap to, so a value outside them fails loudly instead of
    // landing the ship somewhere nobody asked for.
    setShipX: (state, x) =>
      pose((sim) => {
        sim.ship.x = inRange("setShipX(x)", x, SHIP_X_MIN, SHIP_X_MAX);
      })(state),

    // The band the ship holds, and nothing else: no fire lockout is started,
    // because `setFireLockout` is what poses the lockout.
    setShipBand: (state, band) =>
      pose((sim) => {
        sim.ship.band = band;
      })(state),

    setFireLockout: (state, value) =>
      pose((sim) => {
        sim.ship.lockout = seconds("setFireLockout(seconds)", value);
      })(state),

    setFireCooldown: (state, value) =>
      pose((sim) => {
        sim.ship.cooldown = seconds("setFireCooldown(seconds)", value);
      })(state),

    // ---- Resonance and the inversion --------------------------------------

    setResonance: (state, value) =>
      pose((sim) => {
        sim.resonance = inRange("setResonance(value)", value, 0, RESONANCE_MAX);
      })(state),

    setInversion: (state, value) =>
      pose((sim) => {
        sim.inversion = seconds("setInversion(seconds)", value);
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
      poseDrone("setDronePosition", id, (drone) => {
        drone.x = x;
        drone.y = y;
      })(state),

    // The stored band, on every kind, and nothing else: the band clock stays
    // exactly where it stands.
    setDroneBand: (state, id, band) =>
      poseDrone("setDroneBand", id, (drone) => {
        drone.band = band;
      })(state),

    // A phase change starts that phase's own path from its beginning, however
    // the change came about (`specs/state.md`).
    setDronePhase: (state, id, phase) =>
      poseDrone("setDronePhase", id, (drone) => {
        drone.phase = phase;
        drone.phaseClock = 0;
        drone.shotsFired = 0;
      })(state),

    setDroneSlot: (state, id, x, y) =>
      poseDrone("setDroneSlot", id, (drone) => {
        drone.slotX = x;
        drone.slotY = y;
      })(state),

    // How far into the CURRENT band window the Flux is, and nothing else:
    // `shimmer` follows it and the stored band does not change.
    // The seconds it was HANDED, whatever `fluxWindow(stage)` is at the time: the
    // window is a live figure the stage moves, so it is a game rule rather than
    // this argument's domain, and a clock posed past the end of the window stays
    // where it was put until the oscillation reaches it.
    setDroneBandClock: (state, id, value) =>
      poseDroneOfKind("setDroneBandClock", id, "flux", (drone) => {
        drone.bandClock = seconds("setDroneBandClock(seconds)", value);
      })(state),

    setDroneShell: (state, id, intact) =>
      poseDroneOfKind("setDroneShell", id, "prism", (drone) => {
        drone.shellAlive = intact;
      })(state),

    setDroneTravel: (state, id, enabled) =>
      poseDrone("setDroneTravel", id, (drone) => {
        drone.travel = enabled;
      })(state),

    setDroneOscillation: (state, id, enabled) =>
      poseDrone("setDroneOscillation", id, (drone) => {
        drone.oscillation = enabled;
      })(state),

    setDroneFire: (state, id, enabled) =>
      poseDrone("setDroneFire", id, (drone) => {
        drone.fire = enabled;
      })(state),

    removeDrone: (state, id) =>
      pose((sim) => {
        requireId("removeDrone", sim.drones, id);
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
        const bullet = requireId("setBulletVelocity", sim.bullets, id);
        bullet.vx = vx;
        bullet.vy = vy;
      })(state),

    removeBullet: (state, id) =>
      pose((sim) => {
        requireId("removeBullet", sim.bullets, id);
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
        requireId("removeBurst", sim.bursts, id);
        sim.bursts = sim.bursts.filter((burst) => burst.id !== id);
      })(state),

    clearBursts: (state) =>
      pose((sim) => {
        sim.bursts = [];
      })(state),
  };
}
